import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CannedAgentLLM } from "../../src/agent/canned-llm.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";
import type {
  DraftRequest,
  DraftResult,
  HandoffCompletionSink,
  HandoffJobRecord,
  MailFetchContext,
  MailItem,
  MailProvider,
  MessagingChannel,
  OutboundMessage,
  ProviderHealth,
  RestDecisionCandidate,
  RestDecisionContext,
  RestDecisionProvider
} from "../../src/domain/ports.js";
import {
  FixtureMailProvider,
  NoopHandoffCompletionSink
} from "../../src/infra/provider-stubs.js";
import {
  FixtureInboxIntelligenceProvider
} from "../../src/inbox/intelligence.js";
import type { InboxSource } from "../../src/inbox/ports.js";

describe("server dependency graph isolation", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true })
      )
    );
  });

  it("marks normal graphs with missing Claude as mock", () => {
    const dependencies = buildServerDependencies(config());

    expect(graphOrigins(dependencies)).toMatchObject({
      restOrigin: "mock",
      handoffOrigin: "mock",
      inboxOrigin: "mock",
      demoRestOrigin: "mock",
      demoHandoffOrigin: "mock",
      demoInboxOrigin: "mock"
    });
  });

  it("marks the resilient Claude plus canned fallback graph as mock", () => {
    const dependencies = buildServerDependencies(
      config({
        CLAUDE_API_KEY: "not-used-in-test",
        CLAUDE_MODEL: "not-used-in-test"
      })
    );

    expect(graphOrigins(dependencies).restOrigin).toBe("mock");
  });

  it("uses Fixture Inbox intelligence without an Inbox key in test", async () => {
    const dependencies = buildServerDependencies(config());

    await expect(dependencies.providerHealth()).resolves.toMatchObject({
      inbox_intelligence: "ready"
    });
  });

  it("does not use Claude credentials for production Inbox intelligence", async () => {
    const stateFile = await temporaryStateFile();
    const dependencies = buildServerDependencies(
      productionConfig({
        CLAUDE_API_KEY: "not-used-for-inbox",
        CLAUDE_MODEL: "not-used-for-inbox",
        INBOX_STATE_FILE: stateFile
      })
    );

    await expect(
      dependencies.providerHealth()
    ).resolves.toMatchObject({
      inbox_intelligence: "unavailable"
    });
  });

  it("composes StepFun only from Inbox-specific production settings", async () => {
    const stateFile = await temporaryStateFile();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "安全摘要",
                  important_points: [],
                  todos: [],
                  priority: "normal",
                  needs_reply: false,
                  reply_targets: []
                })
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const dependencies = buildServerDependencies(
      productionConfig({
        INBOX_STEPFUN_API_KEY: "inbox-only-test-key",
        INBOX_STEPFUN_BASE_URL: "https://stepfun.example/v1/",
        INBOX_STEPFUN_MODEL: "inbox-model",
        INBOX_STEPFUN_TIMEOUT_MS: "2500",
        INBOX_STATE_FILE: stateFile
      })
    );

    await dependencies.inbox.ingest({
      schema_version: "1.0",
      request_id: "req_stepfun_composition",
      checkpoint: "checkpoint-1",
      events: [inboxEvent("stepfun-message")]
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://stepfun.example/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer inbox-only-test-key"
        }),
        body: expect.stringContaining('"model":"inbox-model"')
      })
    );
  });

  it("marks an Inbox with one configured real provider as real", async () => {
    const stateFile = await temporaryStateFile();
    const dependencies = buildServerDependencies(
      productionConfig({
        INBOX_STEPFUN_API_KEY: "inbox-only-test-key",
        INBOX_STATE_FILE: stateFile,
        LARK_CLI_PATH: "/opt/hush/bin/lark-cli",
        LARK_ACCOUNT_ID: "feishu-demo"
      })
    );

    expect(graphOrigins(dependencies).inboxOrigin).toBe("real");
  });

  it("shares file-backed Inbox state across real composition restarts", async () => {
    const stateFile = await temporaryStateFile();
    const firstSource = source("persistent-message", "checkpoint-1");
    const first = buildServerDependencies(
      developmentConfig({ INBOX_STATE_FILE: stateFile }),
      {
        inboxIntelligence: new FixtureInboxIntelligenceProvider(),
        inboxSources: [
          { source: firstSource, accountId: "outlook-account" }
        ]
      }
    );
    await first.connectorHost.runOnce();

    const resumedPull = vi.fn(async () => ({
      checkpoint: "checkpoint-2",
      items: [],
      participantBindings: []
    }));
    const secondSource: InboxSource = {
      provider: "outlook",
      dataOrigin: "real",
      health: async () => "ready",
      pull: resumedPull
    };
    const second = buildServerDependencies(
      developmentConfig({ INBOX_STATE_FILE: stateFile }),
      {
        inboxIntelligence: new FixtureInboxIntelligenceProvider(),
        inboxSources: [
          { source: secondSource, accountId: "outlook-account" }
        ]
      }
    );
    await second.connectorHost.runOnce();

    expect(resumedPull).toHaveBeenCalledWith(
      expect.objectContaining({ checkpoint: "checkpoint-1" }),
      expect.any(Object)
    );
    await expect(
      second.inbox.listItems({ limit: 20 })
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          provider_message_id: "persistent-message"
        })
      ]
    });
  });

  it("marks a fully real normal graph as real", () => {
    const dependencies = buildServerDependencies(config(), {
      realAgent: new RealAgent(),
      normalRestDecisionProvider: new RealRestDecisionProvider(),
      realMail: new RealMailProvider(),
      completionSink: new RealCompletionSink()
    });

    expect(graphOrigins(dependencies)).toMatchObject({
      restOrigin: "real",
      handoffOrigin: "real"
    });
  });

  it("marks explicit canned and fixture normal providers as mock", () => {
    const dependencies = buildServerDependencies(config(), {
      realAgent: new CannedAgentLLM(),
      realMail: new FixtureMailProvider(),
      completionSink: new NoopHandoffCompletionSink()
    });

    expect(graphOrigins(dependencies)).toMatchObject({
      restOrigin: "mock",
      handoffOrigin: "mock"
    });
  });

  it("never routes Demo completion through the normal messaging channel", async () => {
    const messaging = new CountingMessagingChannel();
    const dependencies = buildServerDependencies(
      config({
        HUSH_DEMO_MODE: "true",
        HUSH_DEMO_TOKEN: "demo-secret"
      }),
      {
        messagingChannel: messaging,
        completionRecipientId: "normal-recipient"
      }
    );
    const request = {
      schema_version: "1.0" as const,
      request_id: "req_demo_graph",
      source: "debug" as const,
      include_gmail: false,
      gmail_account_id: null,
      open_loops: [],
      response_channel: "imessage" as const,
      timezone: "Asia/Shanghai",
      locale: "zh-CN"
    };

    const demoJob = await dependencies.demoHandoff.start(
      request,
      "idem-demo-graph"
    );
    await waitForTerminal(dependencies.demoHandoff, demoJob.job_id);
    expect(messaging.sendCalls).toBe(0);

    const normalJob = await dependencies.handoff.start(
      { ...request, request_id: "req_normal_graph" },
      "idem-normal-graph"
    );
    await waitForTerminal(dependencies.handoff, normalJob.job_id);
    expect(messaging.sendCalls).toBe(1);
  });
});

function graphOrigins(dependencies: object): {
  restOrigin: string | undefined;
  handoffOrigin: string | undefined;
  inboxOrigin: string | undefined;
  demoRestOrigin: string | undefined;
  demoHandoffOrigin: string | undefined;
  demoInboxOrigin: string | undefined;
} {
  return dependencies as {
    restOrigin: string | undefined;
    handoffOrigin: string | undefined;
    inboxOrigin: string | undefined;
    demoRestOrigin: string | undefined;
    demoHandoffOrigin: string | undefined;
    demoInboxOrigin: string | undefined;
  };
}

function config(
  overrides: Record<string, string> = {}
) {
  return loadConfig({
    NODE_ENV: "test",
    PORT: "3001",
    PUBLIC_BASE_URL: "http://localhost:3001",
    LOG_LEVEL: "silent",
    ...overrides
  });
}

function developmentConfig(
  overrides: Record<string, string> = {}
) {
  return loadConfig({
    NODE_ENV: "development",
    PORT: "3001",
    PUBLIC_BASE_URL: "http://localhost:3001",
    LOG_LEVEL: "silent",
    ...overrides
  });
}

function productionConfig(
  overrides: Record<string, string> = {}
) {
  return loadConfig({
    NODE_ENV: "production",
    PORT: "3001",
    PUBLIC_BASE_URL: "https://hush.example.com",
    HUSH_APP_TOKEN: "app-token-000000000000000000000000",
    HUSH_CONNECTOR_TOKEN: "connector-token-00000000000000000000",
    LOG_LEVEL: "silent",
    ...overrides
  });
}

const temporaryDirectories: string[] = [];

async function temporaryStateFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "hush-composition-"));
  temporaryDirectories.push(directory);
  return join(directory, "private", "unified-inbox-state.json");
}

function source(
  providerMessageId: string,
  checkpoint: string
): InboxSource {
  return {
    provider: "outlook",
    dataOrigin: "real",
    health: async () => "ready",
    pull: async ({ accountId }) => ({
      checkpoint,
      participantBindings: [],
      items: [inboxEvent(providerMessageId, accountId)]
    })
  };
}

function inboxEvent(
  providerMessageId: string,
  accountId = "outlook-account"
) {
  return {
    provider: "outlook" as const,
    account_id: accountId,
    conversation_id: "conversation-1",
    conversation_type: "direct" as const,
    conversation_name: "项目会话",
    provider_message_id: providerMessageId,
    sender: "王同学",
    sender_ref: null,
    recipients: [],
    subject: "项目确认",
    content: "请查看项目更新。",
    received_at: "2026-07-24T01:00:00.000Z",
    coverage: {
      source: "official_api" as const,
      complete: true,
      note: null
    }
  };
}

class RealAgent extends CannedAgentLLM {
  readonly dataOrigin = "real" as const;
}

class RealMailProvider implements MailProvider {
  readonly dataOrigin = "real" as const;

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async fetchUnread(_context: MailFetchContext): Promise<MailItem[]> {
    return [];
  }

  async createDraft(_request: DraftRequest): Promise<DraftResult> {
    return { draftId: "real-draft" };
  }
}

class RealRestDecisionProvider implements RestDecisionProvider {
  readonly dataOrigin = "real" as const;

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async decide(
    _context: RestDecisionContext
  ): Promise<RestDecisionCandidate> {
    return {
      shouldOfferRest: false,
      reasonCode: "insufficient_signal",
      message: "",
      defaultQuestId: null
    };
  }
}

class RealCompletionSink implements HandoffCompletionSink {
  readonly dataOrigin = "real" as const;

  async notify(_record: HandoffJobRecord): Promise<void> {}
}

class CountingMessagingChannel implements MessagingChannel {
  readonly dataOrigin = "real" as const;
  sendCalls = 0;

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async send(_message: OutboundMessage): Promise<void> {
    this.sendCalls += 1;
  }
}

async function waitForTerminal(
  service: {
    get(jobId: string, requestId: string): Promise<{
      status: string;
    }>;
  },
  jobId: string
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await service.get(jobId, `req_poll_${attempt}`);
    if (["succeeded", "failed", "cancelled"].includes(state.status)) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Job did not reach a terminal state");
}
