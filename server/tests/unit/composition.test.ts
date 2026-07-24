import { describe, expect, it } from "vitest";
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
  ProviderHealth
} from "../../src/domain/ports.js";
import {
  FixtureMailProvider,
  NoopHandoffCompletionSink
} from "../../src/infra/provider-stubs.js";

describe("server dependency graph isolation", () => {
  it("marks normal graphs with missing Claude as mock", () => {
    const dependencies = buildServerDependencies(config());

    expect(graphOrigins(dependencies)).toMatchObject({
      restOrigin: "mock",
      handoffOrigin: "mock",
      demoRestOrigin: "mock",
      demoHandoffOrigin: "mock"
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

  it("marks a fully real normal graph as real", () => {
    const dependencies = buildServerDependencies(config(), {
      realAgent: new RealAgent(),
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
  demoRestOrigin: string | undefined;
  demoHandoffOrigin: string | undefined;
} {
  return dependencies as {
    restOrigin: string | undefined;
    handoffOrigin: string | undefined;
    demoRestOrigin: string | undefined;
    demoHandoffOrigin: string | undefined;
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
