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
import { InboxService } from "./application/inbox/inbox-service.js";
import { RestService } from "./application/rest/rest-service.js";
import type { AppConfig } from "./config.js";
import { FileRestContentRepository } from "./content/file-rest-content-repository.js";
import {
  type AgentLLM,
  type DataOrigin,
  type DynamicManualRestProvider,
  type DynamicRestDecisionCandidate,
  type HandoffCompletionSink,
  type MailProvider,
  type MessagingChannel,
  type RestDecisionProvider
} from "./domain/ports.js";
import {
  InMemoryFeedbackRepository,
  InMemoryHandoffJobRepository,
  InMemoryIdempotencyStore
} from "./infra/in-memory.js";
import {
  ConsoleMessagingChannel,
  FixtureMailProvider,
  MessagingHandoffCompletionSink,
  NoopHandoffCompletionSink,
  UnavailableMailProvider
} from "./infra/provider-stubs.js";
import { RandomIdGenerator, SystemClock } from "./infra/system.js";
import { InMemoryConfirmationTokenStore } from "./inbox/confirmation.js";
import {
  ConnectorHost,
  type ConnectorAccount
} from "./inbox/connector-host.js";
import { FileInboxStateBackend } from "./inbox/file-state-backend.js";
import {
  InboxSendIdempotencyStore,
  InMemoryCheckpointStore,
  InMemoryInboxDraftRepository,
  InMemoryInboxParticipantDirectory,
  InMemoryInboxRepository
} from "./inbox/in-memory.js";
import {
  FixtureInboxIntelligenceProvider,
  StepFunInboxIntelligenceProvider,
  UnavailableInboxIntelligenceProvider
} from "./inbox/intelligence.js";
import type { InboxProvider } from "./domain/contracts.js";
import type {
  InboxIntelligenceProvider,
  InboxSender
} from "./inbox/ports.js";
import {
  DingTalkDwsAdapter,
  ExecFileCommandRunner,
  FixtureInboxSender,
  LarkCliAdapter,
  OutlookGraphAdapter,
  QqMailAdapter,
  UnavailableInboxSender
} from "./inbox/providers/index.js";
import { InMemoryInboxStateBackend } from "./inbox/state-backend.js";

export interface ServerCompositionOverrides {
  realAgent?: AgentLLM;
  demoAgent?: AgentLLM;
  normalRestDecisionProvider?: RestDecisionProvider;
  demoRestDecisionProvider?: RestDecisionProvider;
  normalDynamicRestDecisionProvider?: RestDecisionProvider<DynamicRestDecisionCandidate>;
  demoDynamicRestDecisionProvider?: RestDecisionProvider<DynamicRestDecisionCandidate>;
  normalDynamicManualRestProvider?: DynamicManualRestProvider;
  demoDynamicManualRestProvider?: DynamicManualRestProvider;
  realMail?: MailProvider;
  demoMail?: MailProvider;
  messagingChannel?: MessagingChannel;
  completionSink?: HandoffCompletionSink;
  demoCompletionSink?: HandoffCompletionSink;
  completionRecipientId?: string;
  inboxIntelligence?: InboxIntelligenceProvider;
  inboxSenders?: ReadonlyMap<InboxProvider, InboxSender>;
  inboxSources?: ConnectorAccount[];
}

export interface ServerComposition extends ServerDependencies {
  connectorHost: ConnectorHost;
}

export function buildServerDependencies(
  config: AppConfig,
  overrides: ServerCompositionOverrides = {}
): ServerComposition {
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
  const normalDynamicManualRestProvider =
    overrides.normalDynamicManualRestProvider ??
    asDynamicManualRestProvider(normalDynamicRestDecisionProvider) ??
    new UnavailableDynamicRestDecisionProvider();
  const demoDynamicManualRestProvider =
    overrides.demoDynamicManualRestProvider ??
    asDynamicManualRestProvider(demoDynamicRestDecisionProvider) ??
    new CannedDynamicRestDecisionProvider();
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
  const realInboxIntelligence =
    overrides.inboxIntelligence ??
    (config.INBOX_STEPFUN_API_KEY
      ? new StepFunInboxIntelligenceProvider({
          baseUrl: config.INBOX_STEPFUN_BASE_URL,
          apiKey: config.INBOX_STEPFUN_API_KEY,
          model: config.INBOX_STEPFUN_MODEL,
          maxMessagesPerChunk: 100,
          maxPromptCharacters: 60_000,
          timeoutMs: config.INBOX_STEPFUN_TIMEOUT_MS
        })
      : ["demo", "test"].includes(config.NODE_ENV)
        ? new FixtureInboxIntelligenceProvider()
        : new UnavailableInboxIntelligenceProvider());
  const demoInboxIntelligence =
    new FixtureInboxIntelligenceProvider();
  const commandRunner = new ExecFileCommandRunner();
  const configuredAccounts: ConnectorAccount[] = [];
  const defaultSenders = new Map<InboxProvider, InboxSender>();

  const feishu =
    config.LARK_CLI_PATH && config.LARK_ACCOUNT_ID
      ? new LarkCliAdapter(
          {
            executable: config.LARK_CLI_PATH,
            accountId: config.LARK_ACCOUNT_ID,
            initialLookbackMinutes:
              config.INBOX_INITIAL_LOOKBACK_MINUTES
          },
          commandRunner
        )
      : null;
  defaultSenders.set(
    "feishu",
    feishu ?? new UnavailableInboxSender("feishu")
  );
  if (feishu) {
    configuredAccounts.push({
      source: feishu,
      accountId: config.LARK_ACCOUNT_ID!
    });
  }

  const dingtalk =
    config.DWS_CLI_PATH && config.DINGTALK_ACCOUNT_ID
      ? new DingTalkDwsAdapter(
          {
            executable: config.DWS_CLI_PATH,
            accountId: config.DINGTALK_ACCOUNT_ID,
            initialLookbackMinutes:
              config.INBOX_INITIAL_LOOKBACK_MINUTES
          },
          commandRunner
        )
      : null;
  defaultSenders.set(
    "dingtalk",
    dingtalk ?? new UnavailableInboxSender("dingtalk")
  );
  if (dingtalk) {
    configuredAccounts.push({
      source: dingtalk,
      accountId: config.DINGTALK_ACCOUNT_ID!
    });
  }

  const outlook =
    config.OUTLOOK_ACCOUNT_ID && config.OUTLOOK_ACCESS_TOKEN
      ? new OutlookGraphAdapter({
          accountId: config.OUTLOOK_ACCOUNT_ID,
          accessToken: async () => config.OUTLOOK_ACCESS_TOKEN!
        })
      : null;
  defaultSenders.set(
    "outlook",
    outlook ?? new UnavailableInboxSender("outlook")
  );
  if (outlook) {
    configuredAccounts.push({
      source: outlook,
      accountId: config.OUTLOOK_ACCOUNT_ID!
    });
  }

  const qqMail =
    config.QQ_EMAIL_ADDRESS && config.QQ_EMAIL_AUTH_CODE
      ? new QqMailAdapter({
          accountId: config.QQ_EMAIL_ADDRESS,
          credentials: async () => ({
            address: config.QQ_EMAIL_ADDRESS!,
            authorizationCode: config.QQ_EMAIL_AUTH_CODE!
          })
        })
      : null;
  defaultSenders.set(
    "qq_mail",
    qqMail ?? new UnavailableInboxSender("qq_mail")
  );
  if (qqMail) {
    configuredAccounts.push({
      source: qqMail,
      accountId: config.QQ_EMAIL_ADDRESS!
    });
  }

  const inboxSenders =
    overrides.inboxSenders ?? defaultSenders;
  const inboxSources =
    overrides.inboxSources ?? configuredAccounts;
  const activeInboxProviders = inboxSources.flatMap(({ source }) => [
    source,
    inboxSenders.get(source.provider) ?? {}
  ]);
  const demoInboxSenders = new Map<InboxProvider, InboxSender>(
    ([
      "feishu",
      "dingtalk",
      "outlook",
      "qq_mail"
    ] as const).map((provider) => [
      provider,
      new FixtureInboxSender(provider)
    ])
  );
  const inboxBackend =
    config.NODE_ENV === "test" || config.NODE_ENV === "demo"
      ? new InMemoryInboxStateBackend()
      : new FileInboxStateBackend(config.INBOX_STATE_FILE);
  const demoInboxBackend = new InMemoryInboxStateBackend();
  const inboxCheckpoints = new InMemoryCheckpointStore(
    clock.now.bind(clock),
    inboxBackend
  );
  const demoInboxCheckpoints = new InMemoryCheckpointStore(
    clock.now.bind(clock),
    demoInboxBackend
  );
  const inboxParticipants = new InMemoryInboxParticipantDirectory(
    inboxBackend
  );
  const demoInboxParticipants = new InMemoryInboxParticipantDirectory(
    demoInboxBackend
  );
  const inbox = new InboxService(
    new InMemoryInboxRepository(inboxBackend),
    new InMemoryInboxDraftRepository(inboxBackend),
    realInboxIntelligence,
    inboxSenders,
    new InMemoryConfirmationTokenStore(clock.now.bind(clock)),
    new InboxSendIdempotencyStore(inboxBackend),
    inboxCheckpoints,
    clock,
    ids,
    inboxParticipants
  );
  const demoInbox = new InboxService(
    new InMemoryInboxRepository(demoInboxBackend),
    new InMemoryInboxDraftRepository(demoInboxBackend),
    demoInboxIntelligence,
    demoInboxSenders,
    new InMemoryConfirmationTokenStore(clock.now.bind(clock)),
    new InboxSendIdempotencyStore(demoInboxBackend),
    demoInboxCheckpoints,
    clock,
    ids,
    demoInboxParticipants
  );
  const connectorHost = new ConnectorHost(
    inboxSources,
    inbox,
    inboxCheckpoints,
    ids,
    config.INBOX_POLL_INTERVAL_MS,
    Date.now,
    30_000,
    config.INBOX_SYNC_BATCH_LIMIT
  );

  return {
    config,
    restDecisionOrigin: graphOrigin(normalDynamicRestDecisionProvider),
    manualRestOrigin: graphOrigin(normalDynamicManualRestProvider),
    legacyRestDecisionOrigin: graphOrigin(normalRestDecisionProvider),
    restDecisionHealth:
      normalDynamicRestDecisionProvider.configurationHealth ??
      "unknown",
    restOrigin: graphOrigin(realAgent),
    handoffOrigin: graphOrigin(realAgent, realMail, completionSink),
    inboxOrigin:
      inboxSources.length === 0
        ? "mock"
        : graphOrigin(realInboxIntelligence, ...activeInboxProviders),
    demoRestOrigin: "mock",
    demoHandoffOrigin: "mock",
    demoInboxOrigin: "mock",
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
        dynamicManualRestProvider: normalDynamicManualRestProvider,
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
        dynamicManualRestProvider: demoDynamicManualRestProvider,
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
    inbox,
    demoInbox,
    connectorHost,
    providerHealth: async () => ({
      agent: await realAgent.health(),
      rest_decision: await normalDynamicRestDecisionProvider.health(),
      gmail: await realMail.health(),
      inbox_intelligence: await realInboxIntelligence.health(),
      feishu: await inboxSenders.get("feishu")!.health(),
      dingtalk: await inboxSenders.get("dingtalk")!.health(),
      outlook: await inboxSenders.get("outlook")!.health(),
      qq_mail: await inboxSenders.get("qq_mail")!.health(),
      inbox_connector:
        inboxSources.length > 0 ? "ready" : "unavailable",
      messaging_fallback: await messaging.health(),
      rest_content: "ready",
      handoff_jobs: "ready"
    })
  };
}

function createDynamicRestDecisionProvider(
  config: AppConfig
): DynamicRestProvider {
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

type DynamicRestProvider =
  RestDecisionProvider<DynamicRestDecisionCandidate> &
  DynamicManualRestProvider;

function asDynamicManualRestProvider(
  provider: RestDecisionProvider<DynamicRestDecisionCandidate>
): DynamicManualRestProvider | null {
  return "generate" in provider &&
    typeof provider.generate === "function"
    ? (provider as RestDecisionProvider<DynamicRestDecisionCandidate> &
        DynamicManualRestProvider)
    : null;
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
