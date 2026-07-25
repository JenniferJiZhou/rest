import { CannedAgentLLM } from "./agent/canned-llm.js";
import { ClaudeAgentLLM } from "./agent/claude-llm.js";
import { ResilientAgentLLM } from "./agent/resilient-llm.js";
import {
  CannedDynamicRestDecisionProvider,
  CannedRestDecisionProvider,
  UnavailableDynamicRestDecisionProvider,
  UnavailableRestDecisionProvider
} from "./agent/rest-decision-providers.js";
import {
  DynamicRestDecisionProvider
} from "./agent/rest-decision/dynamic-rest-decision-provider.js";
import {
  AnthropicRestDecisionModelClient,
  RealRestDecisionProvider
} from "./agent/rest-decision/real-rest-decision-provider.js";
import { StepFunRestDecisionClient } from "./agent/rest-decision/stepfun-rest-decision-client.js";
import type { ServerDependencies } from "./api/create-server.js";
import { HandoffService } from "./application/handoff/handoff-service.js";
import { UnifiedInboxService } from "./application/inbox/unified-inbox-service.js";
import { RestService } from "./application/rest/rest-service.js";
import type { AppConfig } from "./config.js";
import { FileRestContentRepository } from "./content/file-rest-content-repository.js";
import {
  InMemoryFeedbackRepository,
  InMemoryHandoffJobRepository,
  InMemoryIdempotencyStore,
  InMemoryUnifiedInboxRepository
} from "./infra/in-memory.js";
import {
  type AgentLLM,
  type DataOrigin,
  type DynamicRestDecisionCandidate,
  type HandoffCompletionSink,
  type MailProvider,
  type MessagingChannel,
  type RestDecisionProvider,
  type UnifiedInboxProvider
} from "./domain/ports.js";
import {
  ConsoleMessagingChannel,
  FixtureMailProvider,
  MessagingHandoffCompletionSink,
  NoopHandoffCompletionSink,
  UnavailableMailProvider
} from "./infra/provider-stubs.js";
import { RandomIdGenerator, SystemClock } from "./infra/system.js";
import {
  CannedUnifiedInboxProvider,
  UnavailableUnifiedInboxProvider
} from "./infra/unified-inbox-providers.js";

export interface ServerCompositionOverrides {
  realAgent?: AgentLLM;
  demoAgent?: AgentLLM;
  normalRestDecisionProvider?: RestDecisionProvider;
  demoRestDecisionProvider?: RestDecisionProvider;
  normalDynamicRestDecisionProvider?: RestDecisionProvider<DynamicRestDecisionCandidate>;
  demoDynamicRestDecisionProvider?: RestDecisionProvider<DynamicRestDecisionCandidate>;
  normalInboxProvider?: UnifiedInboxProvider;
  demoInboxProvider?: UnifiedInboxProvider;
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
  const normalRestDecisionProvider =
    overrides.normalRestDecisionProvider ??
    createRestDecisionProvider(config, content);
  const demoRestDecisionProvider =
    overrides.demoRestDecisionProvider ??
    new CannedRestDecisionProvider(content);
  const normalDynamicRestDecisionProvider =
    overrides.normalDynamicRestDecisionProvider ??
    createDynamicRestDecisionProvider(config);
  const demoDynamicRestDecisionProvider =
    overrides.demoDynamicRestDecisionProvider ??
    new CannedDynamicRestDecisionProvider();
  const normalInboxProvider =
    overrides.normalInboxProvider ??
    (config.HUSH_UNIFIED_INBOX_PROVIDER === "canned"
      ? new CannedUnifiedInboxProvider()
      : new UnavailableUnifiedInboxProvider());
  const demoInboxProvider =
    overrides.demoInboxProvider ?? new CannedUnifiedInboxProvider();
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
    restDecisionOrigin: graphOrigin(normalDynamicRestDecisionProvider),
    legacyRestDecisionOrigin: graphOrigin(normalRestDecisionProvider),
    restDecisionHealth:
      normalDynamicRestDecisionProvider.configurationHealth ??
      "unknown",
    restOrigin: graphOrigin(realAgent),
    handoffOrigin: graphOrigin(realAgent, realMail, completionSink),
    demoRestOrigin: "mock",
    demoHandoffOrigin: "mock",
    inboxOrigin: graphOrigin(normalInboxProvider),
    demoInboxOrigin: "mock",
    inbox: new UnifiedInboxService(
      normalInboxProvider,
      new InMemoryUnifiedInboxRepository(),
      new InMemoryIdempotencyStore<unknown>(),
      clock,
      ids
    ),
    demoInbox: new UnifiedInboxService(
      demoInboxProvider,
      new InMemoryUnifiedInboxRepository(),
      new InMemoryIdempotencyStore<unknown>(),
      clock,
      ids
    ),
    rest: new RestService(
      realAgent,
      content,
      new InMemoryFeedbackRepository(),
      new InMemoryIdempotencyStore<unknown>(),
      normalRestDecisionProvider,
      {
        llmTimeoutMs: config.LLM_TIMEOUT_MS,
        restDecisionTimeoutMs: config.REST_DECISION_TIMEOUT_MS,
        dynamicDecisionProvider: normalDynamicRestDecisionProvider,
        dynamicRestDecisionTimeoutMs: config.STEPFUN_TIMEOUT_MS
      }
    ),
    demoRest: new RestService(
      demoAgent,
      content,
      new InMemoryFeedbackRepository(),
      new InMemoryIdempotencyStore<unknown>(),
      demoRestDecisionProvider,
      {
        llmTimeoutMs: config.LLM_TIMEOUT_MS,
        restDecisionTimeoutMs: config.REST_DECISION_TIMEOUT_MS,
        dynamicDecisionProvider: demoDynamicRestDecisionProvider,
        dynamicRestDecisionTimeoutMs: config.STEPFUN_TIMEOUT_MS
      }
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
      rest_decision: await normalDynamicRestDecisionProvider.health(),
      gmail: await realMail.health(),
      messaging_fallback: await messaging.health(),
      unified_inbox: await normalInboxProvider.health(),
      rest_content: "ready",
      handoff_jobs: "ready"
    })
  };
}

function createDynamicRestDecisionProvider(
  config: AppConfig
): RestDecisionProvider<DynamicRestDecisionCandidate> {
  if (config.HUSH_REST_DECISION_PROVIDER === "canned") {
    return new CannedDynamicRestDecisionProvider();
  }
  if (config.HUSH_REST_DECISION_PROVIDER === "unavailable") {
    return new UnavailableDynamicRestDecisionProvider();
  }
  if (
    !config.STEPFUN_API_KEY ||
    !config.STEPFUN_MODEL ||
    !config.STEPFUN_BASE_URL
  ) {
    return new UnavailableDynamicRestDecisionProvider();
  }
  return new DynamicRestDecisionProvider(
    new StepFunRestDecisionClient(
      config.STEPFUN_API_KEY,
      config.STEPFUN_BASE_URL
    ),
    config.STEPFUN_MODEL
  );
}

function createRestDecisionProvider(
  config: AppConfig,
  content: FileRestContentRepository
): RestDecisionProvider {
  if (config.HUSH_REST_DECISION_PROVIDER === "canned") {
    return new CannedRestDecisionProvider(content);
  }
  if (config.HUSH_REST_DECISION_PROVIDER === "unavailable") {
    return new UnavailableRestDecisionProvider();
  }
  const model = config.REST_DECISION_MODEL ?? config.CLAUDE_MODEL;
  if (!config.CLAUDE_API_KEY || !model) {
    return new UnavailableRestDecisionProvider();
  }
  return new RealRestDecisionProvider(
    new AnthropicRestDecisionModelClient(
      config.CLAUDE_API_KEY,
      config.CLAUDE_BASE_URL
    ),
    model,
    content
  );
}

function graphOrigin(
  ...providers: Array<{ dataOrigin?: DataOrigin }>
): DataOrigin {
  return providers.every((provider) => provider.dataOrigin === "real")
    ? "real"
    : "mock";
}
