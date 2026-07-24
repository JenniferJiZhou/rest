import { CannedAgentLLM } from "./agent/canned-llm.js";
import { ClaudeAgentLLM } from "./agent/claude-llm.js";
import { ResilientAgentLLM } from "./agent/resilient-llm.js";
import type { ServerDependencies } from "./api/create-server.js";
import { HandoffService } from "./application/handoff/handoff-service.js";
import { RestService } from "./application/rest/rest-service.js";
import type { AppConfig } from "./config.js";
import { FileRestContentRepository } from "./content/file-rest-content-repository.js";
import {
  InMemoryFeedbackRepository,
  InMemoryHandoffJobRepository,
  InMemoryIdempotencyStore
} from "./infra/in-memory.js";
import {
  type AgentLLM,
  type DataOrigin,
  type HandoffCompletionSink,
  type MailProvider,
  type MessagingChannel
} from "./domain/ports.js";
import {
  ConsoleMessagingChannel,
  FixtureMailProvider,
  MessagingHandoffCompletionSink,
  NoopHandoffCompletionSink,
  UnavailableMailProvider
} from "./infra/provider-stubs.js";
import { RandomIdGenerator, SystemClock } from "./infra/system.js";

export interface ServerCompositionOverrides {
  realAgent?: AgentLLM;
  demoAgent?: AgentLLM;
  realMail?: MailProvider;
  demoMail?: MailProvider;
  messagingChannel?: MessagingChannel;
  completionSink?: HandoffCompletionSink;
  demoCompletionSink?: HandoffCompletionSink;
  completionRecipientId?: string;
}

export function buildServerDependencies(
  config: AppConfig,
  overrides: ServerCompositionOverrides = {}
): ServerDependencies {
  const content = new FileRestContentRepository();
  const localAgent = new CannedAgentLLM();
  const realAgent =
    overrides.realAgent ??
    (config.CLAUDE_API_KEY && config.CLAUDE_MODEL
      ? new ResilientAgentLLM(
          new ClaudeAgentLLM(
            config.CLAUDE_API_KEY,
            config.CLAUDE_MODEL
          ),
          localAgent
        )
      : localAgent);
  const demoAgent = overrides.demoAgent ?? new CannedAgentLLM();
  const realMail = overrides.realMail ?? new UnavailableMailProvider();
  const demoMail = overrides.demoMail ?? new FixtureMailProvider();
  const messaging =
    overrides.messagingChannel ?? new ConsoleMessagingChannel();
  const completionSink =
    overrides.completionSink ??
    (overrides.completionRecipientId
      ? new MessagingHandoffCompletionSink(
          messaging,
          overrides.completionRecipientId
        )
      : new NoopHandoffCompletionSink());
  const demoCompletionSink =
    overrides.demoCompletionSink ?? new NoopHandoffCompletionSink();
  if (demoCompletionSink === completionSink) {
    throw new Error(
      "Demo and normal Handoff graphs require distinct completion sinks."
    );
  }
  const clock = new SystemClock();
  const ids = new RandomIdGenerator();

  return {
    config,
    restOrigin: graphOrigin(realAgent),
    handoffOrigin: graphOrigin(realAgent, realMail, completionSink),
    demoRestOrigin: "mock",
    demoHandoffOrigin: "mock",
    rest: new RestService(
      realAgent,
      content,
      new InMemoryFeedbackRepository(),
      new InMemoryIdempotencyStore<boolean>(),
      { llmTimeoutMs: config.LLM_TIMEOUT_MS }
    ),
    demoRest: new RestService(
      demoAgent,
      content,
      new InMemoryFeedbackRepository(),
      new InMemoryIdempotencyStore<boolean>(),
      { llmTimeoutMs: config.LLM_TIMEOUT_MS }
    ),
    handoff: new HandoffService(
      new InMemoryHandoffJobRepository(),
      new InMemoryIdempotencyStore<string>(),
      realMail,
      realAgent,
      completionSink,
      clock,
      ids,
      {
        timeouts: {
          llmMs: config.LLM_TIMEOUT_MS,
          mailFetchMs: config.MAIL_FETCH_TIMEOUT_MS,
          draftCreateMs: config.DRAFT_CREATE_TIMEOUT_MS,
          completionMs: config.COMPLETION_SEND_TIMEOUT_MS
        }
      }
    ),
    demoHandoff: new HandoffService(
      new InMemoryHandoffJobRepository(),
      new InMemoryIdempotencyStore<string>(),
      demoMail,
      demoAgent,
      demoCompletionSink,
      clock,
      ids,
      {
        timeouts: {
          llmMs: config.LLM_TIMEOUT_MS,
          mailFetchMs: config.MAIL_FETCH_TIMEOUT_MS,
          draftCreateMs: config.DRAFT_CREATE_TIMEOUT_MS,
          completionMs: config.COMPLETION_SEND_TIMEOUT_MS
        }
      }
    ),
    providerHealth: async () => ({
      agent: await realAgent.health(),
      gmail: await realMail.health(),
      messaging_fallback: await messaging.health(),
      rest_content: "ready",
      handoff_jobs: "ready"
    })
  };
}

function graphOrigin(
  ...providers: Array<{ dataOrigin?: DataOrigin }>
): DataOrigin {
  return providers.every((provider) => provider.dataOrigin === "real")
    ? "real"
    : "mock";
}
