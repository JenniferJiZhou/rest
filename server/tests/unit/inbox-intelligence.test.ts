import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FetchStepFunTransport,
  FixtureInboxIntelligenceProvider,
  StepFunInboxIntelligenceProvider,
  UnavailableInboxIntelligenceProvider,
  type StepFunInboxConfig,
  type StepFunTransport
} from "../../src/inbox/intelligence.js";
import type {
  InboxSummaryInput,
  ReplyDraftInput
} from "../../src/inbox/ports.js";

const config: StepFunInboxConfig = {
  baseUrl: "https://api.stepfun.com/step_plan/v1",
  apiKey: "stepfun-test-secret",
  model: "step-3.7-flash",
  maxMessagesPerChunk: 100,
  maxPromptCharacters: 60_000
};

describe("Inbox intelligence providers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the exact StepFun endpoint, model, and bearer header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "```json\n{\"ok\":true}\n```"
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new FetchStepFunTransport();

    await expect(
      transport.completeJson({
        endpoint:
          "https://api.stepfun.com/step_plan/v1/chat/completions",
        apiKey: config.apiKey,
        model: config.model,
        prompt: "safe prompt"
      })
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stepfun.com/step_plan/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "step-3.7-flash",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: "safe prompt" }]
        })
      })
    );
  });

  it("sends only safe conversation fields through the recording transport", async () => {
    const transport = new RecordingTransport([summaryResult()]);
    const provider = new StepFunInboxIntelligenceProvider(
      config,
      transport
    );
    const input = {
      ...summaryInput(),
      provider: "feishu",
      accountId: "account-raw-001",
      conversationId: "conversation-raw-001",
      messages: [
        {
          ...summaryInput().messages[0]!,
          providerMessageId: "provider-message-raw-001",
          providerParticipantId: "provider-participant-raw-001"
        }
      ],
      allowedParticipants: [
        {
          ...summaryInput().allowedParticipants[0]!,
          providerParticipantId: "provider-participant-raw-001"
        }
      ]
    } as unknown as InboxSummaryInput;

    await provider.summarize(input);

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toMatchObject({
      endpoint:
        "https://api.stepfun.com/step_plan/v1/chat/completions",
      apiKey: "stepfun-test-secret",
      model: "step-3.7-flash"
    });
    const prompt = transport.requests[0]!.prompt;
    expect(prompt).toContain("conversation_name");
    expect(prompt).toContain("项目讨论组");
    expect(prompt).toContain("display_name");
    expect(prompt).toContain("王同学");
    expect(prompt).toContain("participant_ref");
    expect(prompt).toContain("participant_demo_0001");
    expect(prompt).toContain("请王同学确认接口交付时间。");
    expect(prompt).toContain("2026-07-24T09:00:00+08:00");
    expect(prompt).not.toContain(config.apiKey);
    expect(prompt).not.toContain("account-raw-001");
    expect(prompt).not.toContain("conversation-raw-001");
    expect(prompt).not.toContain("provider-message-raw-001");
    expect(prompt).not.toContain("provider-participant-raw-001");
    expect(prompt).not.toMatch(
      /account_id|conversation_id|provider_message_id|provider_participant_id/i
    );
  });

  it("rejects a reply target outside the allowed participants", async () => {
    const transport = new RecordingTransport([
      summaryResult({
        reply_targets: [
          {
            target_id: "participant_intruder_0001",
            display_name: "未知人员",
            reason: "模型擅自选择"
          }
        ]
      })
    ]);
    const provider = new StepFunInboxIntelligenceProvider(
      config,
      transport
    );

    await expect(
      provider.summarize(summaryInput())
    ).rejects.toMatchObject({
      code: "INBOX_AI_UNAVAILABLE",
      retryable: false,
      details: { reason: "invalid_output" }
    });
  });

  it("maps 1000 messages in bounded chunks and reduces once", async () => {
    const transport = new RecordingTransport();
    const provider = new StepFunInboxIntelligenceProvider(
      config,
      transport
    );
    const input = summaryInput({
      messages: Array.from({ length: 1_000 }, (_, index) => ({
        participantRef: "participant_demo_0001",
        displayName: "王同学",
        content: `第 ${index + 1} 条短消息`,
        receivedAt: "2026-07-24T09:00:00+08:00"
      }))
    });

    await provider.summarize(input);

    expect(transport.requests.length).toBeGreaterThan(1);
    expect(
      transport.requests.every(
        (request) =>
          request.messageCount <= 100 &&
          request.prompt.length <= 60_000
      )
    ).toBe(true);
    expect(
      transport.requests.filter((request) =>
        request.prompt.includes('"operation":"reduce"')
      )
    ).toHaveLength(1);
    expect(
      transport.requests.filter((request) =>
        request.prompt.includes('"operation":"map"')
      ).length
    ).toBeGreaterThan(1);
  });

  it("slices one oversized message without issuing an oversized request", async () => {
    const transport = new RecordingTransport();
    const provider = new StepFunInboxIntelligenceProvider(
      config,
      transport
    );

    await provider.summarize(
      summaryInput({
        messages: [
          {
            participantRef: "participant_demo_0001",
            displayName: "王同学",
            content: "长".repeat(130_000),
            receivedAt: "2026-07-24T09:00:00+08:00"
          }
        ]
      })
    );

    expect(transport.requests.length).toBeGreaterThan(1);
    expect(
      transport.requests.every(
        (request) =>
          request.messageCount <= 100 &&
          request.prompt.length <= 60_000
      )
    ).toBe(true);
  });

  it("validates the final reduce targets and de-duplicates them", async () => {
    const targets = Array.from({ length: 21 }, (_, index) => ({
      target_id: `participant_demo_${String(index + 1).padStart(4, "0")}`,
      display_name: `参与者 ${index + 1}`,
      reason: `第 ${index + 1} 位参与者需要确认`
    }));
    const transport = new RecordingTransport([
      summaryResult(),
      summaryResult(),
      summaryResult({
        reply_targets: [targets[0], targets[0], ...targets.slice(1)]
      })
    ]);
    const provider = new StepFunInboxIntelligenceProvider(
      { ...config, maxMessagesPerChunk: 1 },
      transport
    );

    await expect(
      provider.summarize(
        summaryInput({
          allowedParticipants: targets.map((target) => ({
            participantRef: target.target_id,
            displayName: target.display_name
          })),
          messages: [
            summaryInput().messages[0]!,
            {
              participantRef: "participant_demo_0001",
              displayName: "王同学",
              content: "第二条消息。",
              receivedAt: "2026-07-24T09:01:00+08:00"
            }
          ]
        })
      )
    ).resolves.toMatchObject({
      reply_targets: targets.slice(0, 20)
    });
  });

  it("rejects a disallowed target from the final reduce output", async () => {
    const transport = new RecordingTransport([
      summaryResult(),
      summaryResult(),
      summaryResult({
        reply_targets: [
          {
            target_id: "participant_intruder_0001",
            display_name: "未知人员",
            reason: "模型擅自选择"
          }
        ]
      })
    ]);
    const provider = new StepFunInboxIntelligenceProvider(
      { ...config, maxMessagesPerChunk: 1 },
      transport
    );

    await expect(
      provider.summarize(
        summaryInput({
          messages: [
            summaryInput().messages[0]!,
            {
              participantRef: "participant_demo_0001",
              displayName: "王同学",
              content: "第二条消息。",
              receivedAt: "2026-07-24T09:01:00+08:00"
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      code: "INBOX_AI_UNAVAILABLE",
      retryable: false,
      details: { reason: "invalid_output" }
    });
  });

  it("sanitizes malformed JSON and non-2xx provider responses", async () => {
    const malformed = new StepFunInboxIntelligenceProvider(
      config,
      new RecordingTransport(["not-json"])
    );
    await expect(
      malformed.summarize(summaryInput())
    ).rejects.toMatchObject({
      code: "INBOX_AI_UNAVAILABLE",
      retryable: false,
      details: { reason: "invalid_output" }
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("private provider response body", {
          status: 500
        })
      )
    );
    const failed = new StepFunInboxIntelligenceProvider(config);
    const error = await failed
      .summarize(summaryInput())
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "INBOX_AI_UNAVAILABLE",
      retryable: true,
      details: { reason: "provider_error" }
    });
    expect(JSON.stringify(error)).not.toContain(
      "private provider response body"
    );
  });

  it("drafts from validated summaries and target display names only", async () => {
    const transport = new RecordingTransport([
      { content: "我会按时确认。", content_type: "text" }
    ]);
    const provider = new StepFunInboxIntelligenceProvider(
      config,
      transport
    );

    await expect(
      provider.draftReply(draftInput())
    ).resolves.toEqual({
      content: "我会按时确认。",
      contentType: "text"
    });
    const prompt = transport.requests[0]!.prompt;
    expect(prompt).toContain("需要确认接口交付时间");
    expect(prompt).toContain("王同学");
    expect(prompt).not.toContain("provider-participant-raw-001");
    expect(prompt).not.toMatch(/account_id|provider_message_id/i);
  });

  it("keeps fixture and unavailable implementations contract-correct", async () => {
    const fixture = new FixtureInboxIntelligenceProvider();
    const input = summaryInput();

    await expect(fixture.summarize(input)).resolves.toEqual(
      await fixture.summarize(input)
    );
    await expect(fixture.summarize(input)).resolves.toMatchObject({
      summary: expect.stringContaining("项目讨论组"),
      reply_targets: [
        expect.objectContaining({
          target_id: "participant_demo_0001",
          display_name: "王同学"
        })
      ]
    });
    await expect(
      fixture.summarize(
        summaryInput({
          messages: [
            {
              participantRef: "participant_demo_0001",
              displayName: "王同学",
              content: "今天午饭很好吃。",
              receivedAt: "2026-07-24T09:00:00+08:00"
            }
          ]
        })
      )
    ).resolves.toMatchObject({ reply_targets: [] });
    await expect(
      fixture.summarize(
        summaryInput({
          allowedParticipants: [],
          messages: [
            {
              participantRef: null,
              displayName: "项目同事",
              content: "请确认项目时间并回复。",
              receivedAt: "2026-07-24T09:00:00+08:00"
            }
          ]
        })
      )
    ).resolves.toMatchObject({
      needs_reply: true,
      reply_targets: []
    });
    await expect(fixture.draftReply(draftInput())).resolves.toEqual({
      content: "收到，我会查看并尽快回复。",
      contentType: "text"
    });

    const unavailable = new UnavailableInboxIntelligenceProvider();
    await expect(unavailable.health()).resolves.toBe("unavailable");
    await expect(
      unavailable.summarize(summaryInput())
    ).rejects.toMatchObject({
      code: "INBOX_AI_UNAVAILABLE",
      retryable: true,
      details: null
    });
  });
});

interface RecordedRequest {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  messageCount: number;
}

class RecordingTransport implements StepFunTransport {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly responses: unknown[] = []) {}

  async completeJson(input: {
    endpoint: string;
    apiKey: string;
    model: string;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    this.requests.push({
      endpoint: input.endpoint,
      apiKey: input.apiKey,
      model: input.model,
      prompt: input.prompt,
      messageCount: input.prompt.match(/"received_at":/gu)?.length ?? 0
    });
    return this.responses.shift() ?? summaryResult();
  }
}

function summaryInput(
  overrides: Partial<InboxSummaryInput> = {}
): InboxSummaryInput {
  return {
    conversationName: "项目讨论组",
    allowedParticipants: [
      {
        participantRef: "participant_demo_0001",
        displayName: "王同学"
      }
    ],
    messages: [
      {
        participantRef: "participant_demo_0001",
        displayName: "王同学",
        content: "请王同学确认接口交付时间。",
        receivedAt: "2026-07-24T09:00:00+08:00"
      }
    ],
    ...overrides
  };
}

function draftInput(): ReplyDraftInput {
  return {
    ...summaryInput(),
    summary: "需要确认接口交付时间。",
    importantPoints: ["交付时间待确认"],
    todos: ["确认交付时间"],
    priority: "normal",
    needsReply: true,
    replyTargets: [
      {
        displayName: "王同学",
        reason: "需要确认接口交付时间",
        providerParticipantId: "provider-participant-raw-001"
      }
    ]
  } as unknown as ReplyDraftInput;
}

function summaryResult(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    summary: "需要确认接口交付时间。",
    important_points: ["交付时间待确认"],
    todos: ["确认交付时间"],
    priority: "normal",
    needs_reply: true,
    reply_targets: [],
    ...overrides
  };
}
