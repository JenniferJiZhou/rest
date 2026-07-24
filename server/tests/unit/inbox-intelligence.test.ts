import { describe, expect, it, vi } from "vitest";

const anthropicCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: anthropicCreate };
  }
}));

import {
  FixtureInboxIntelligenceProvider,
  RealInboxIntelligenceProvider,
  UnavailableInboxIntelligenceProvider
} from "../../src/inbox/intelligence.js";
import type {
  InboxSummaryInput,
  ReplyDraftInput
} from "../../src/inbox/ports.js";

describe("Inbox intelligence providers", () => {
  it("returns deterministic summaries and drafts from message content", async () => {
    const provider = new FixtureInboxIntelligenceProvider();
    const input = summaryInput();

    await expect(provider.summarize(input)).resolves.toEqual(
      await provider.summarize(input)
    );
    await expect(provider.draftReply(draftInput())).resolves.toEqual({
      content: "收到，我会查看并尽快回复。",
      contentType: "text"
    });
    await expect(provider.health()).resolves.toBe("ready");
  });

  it("keeps credentials and confirmation data outside intelligence inputs", () => {
    const serialized = JSON.stringify({
      summary: summaryInput(),
      draft: draftInput()
    });

    expect(serialized).not.toMatch(
      /access_token|refresh_token|auth_code|confirmation_token|credential/i
    );
  });

  it("fails with a sanitized unavailable error", async () => {
    const provider = new UnavailableInboxIntelligenceProvider();

    await expect(provider.health()).resolves.toBe("unavailable");
    await expect(provider.summarize(summaryInput())).rejects.toMatchObject({
      code: "INBOX_AI_UNAVAILABLE",
      retryable: true,
      details: null
    });
  });

  it("requests and parses required reply targets from the real provider", async () => {
    anthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: "需要确认接口交付时间。",
            important_points: ["交付时间待确认"],
            todos: ["确认交付时间"],
            priority: "normal",
            needs_reply: true,
            reply_targets: [
              {
                target_id: "participant_demo_0001",
                display_name: "王同学",
                reason: "需要确认接口交付时间"
              }
            ]
          })
        }
      ]
    });
    const provider = new RealInboxIntelligenceProvider(
      "test-key",
      "test-model"
    );

    await expect(provider.summarize(summaryInput())).resolves.toMatchObject({
      reply_targets: [
        {
          target_id: "participant_demo_0001",
          display_name: "王同学"
        }
      ]
    });
    expect(anthropicCreate.mock.calls[0]?.[0].messages[0].content).toContain(
      "reply_targets"
    );
  });

  it("sanitizes real-provider summaries that omit reply targets", async () => {
    anthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary: "需要确认接口交付时间。",
            important_points: [],
            todos: [],
            priority: "normal",
            needs_reply: true
          })
        }
      ]
    });
    const provider = new RealInboxIntelligenceProvider(
      "test-key",
      "test-model"
    );

    await expect(provider.summarize(summaryInput())).rejects.toMatchObject({
      code: "INBOX_AI_UNAVAILABLE",
      retryable: false,
      details: { reason: "invalid_output" }
    });
  });
});

function summaryInput(): InboxSummaryInput {
  return {
    provider: "feishu",
    sender: "同事",
    recipients: ["我"],
    subject: null,
    content: "请查看本周计划并回复。",
    receivedAt: "2026-07-24T09:00:00+08:00"
  };
}

function draftInput(): ReplyDraftInput {
  return {
    ...summaryInput(),
    summary: "同事请我查看本周计划。",
    importantPoints: ["查看本周计划"],
    todos: ["回复同事"],
    priority: "normal",
    needsReply: true
  };
}
