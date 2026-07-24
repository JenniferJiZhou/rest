import { CannedAgentLLM } from "./agent/canned-llm.js";
import { ClaudeAgentLLM } from "./agent/claude-llm.js";
import { ResilientAgentLLM } from "./agent/resilient-llm.js";
import {
  CannedRestDecisionProvider,
  UnavailableRestDecisionProvider
} from "./agent/rest-decision-providers.js";
import type { ServerDependencies } from "./api/create-server.js";
import { HandoffService } from "./application/handoff/handoff-service.js";
import { InboxService } from "./application/inbox/inbox-service.js";
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
  type MessagingChannel,
  type RestDecisionProvider
} from "./domain/ports.js";
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
  InMemoryCheckpointStore,
  InMemoryInboxDraftRepository,
  InMemoryInboxRepository
} from "./inbox/in-memory.js";
import {
  FixtureInboxIntelligenceProvider,
  RealInboxIntelligenceProvider,
  UnavailableInboxIntelligenceProvider
} from "./inbox/intelligence.js";
import type {
  InboxProvider,
  InboxSendResult
} from "./domain/contracts.js";
import type {
  InboxIntelligenceProvider,
  InboxSender
} from "./inbox/ports.js";
import { ConnectorHost, type ConnectorAccount } from "./inbox/connector-host.js";
import {
  DingTalkDwsAdapter,
  ExecFileCommandRunner,
  FixtureInboxSender,
  LarkCliAdapter,
  OutlookGraphAdapter,
  QqMailAdapter,
  UnavailableInboxSender
} from "./inbox/providers/index.js";

export interface ServerCompositionOverrides {
  realAgent?: AgentLLM;
  demoAgent?: AgentLLM;
  normalRestDecisionProvider?: RestDecisionProvider;
  demoRestDecisionProvider?: RestDecisionProvider;
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
    (config.HUSH_REST_DECISION_PROVIDER === "unavailable"
      ? new UnavailableRestDecisionProvider()
      : new CannedRestDecisionProvider(content));
  const demoRestDecisionProvider =
    overrides.demoRestDecisionProvider ??
    new CannedRestDecisionProvider(content);
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
    (config.CLAUDE_API_KEY && config.CLAUDE_MODEL
      ? new RealInboxIntelligenceProvider(
          config.CLAUDE_API_KEY,
          config.CLAUDE_MODEL
        )
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
            accountId: config.LARK_ACCOUNT_ID
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
            accountId: config.DINGTALK_ACCOUNT_ID
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
  const inboxCheckpoints = new InMemoryCheckpointStore(
    clock.now.bind(clock)
  );
  const demoInboxCheckpoints = new InMemoryCheckpointStore(
    clock.now.bind(clock)
  );
  const inbox = new InboxService(
    new InMemoryInboxRepository(),
    new InMemoryInboxDraftRepository(),
    realInboxIntelligence,
    inboxSenders,
    new InMemoryConfirmationTokenStore(clock.now.bind(clock)),
    new InMemoryIdempotencyStore<InboxSendResult>(),
    inboxCheckpoints,
    clock,
    ids
  );
  const demoInbox = new InboxService(
    new InMemoryInboxRepository(),
    new InMemoryInboxDraftRepository(),
    demoInboxIntelligence,
    demoInboxSenders,
    new InMemoryConfirmationTokenStore(clock.now.bind(clock)),
    new InMemoryIdempotencyStore<InboxSendResult>(),
    demoInboxCheckpoints,
    clock,
    ids
  );
  const connectorHost = new ConnectorHost(
    inboxSources,
    inbox,
    inboxCheckpoints,
    ids,
    config.INBOX_POLL_INTERVAL_MS
  );

  return {
    config,
    restOrigin: graphOrigin(realAgent, normalRestDecisionProvider),
    handoffOrigin: graphOrigin(realAgent, realMail, completionSink),
    inboxOrigin: graphOrigin(
      realInboxIntelligence,
      ...inboxSenders.values()
    ),
    demoRestOrigin: "mock",
    demoHandoffOrigin: "mock",
    demoInboxOrigin: "mock",
    rest: new RestService(
      realAgent,
      content,
      new InMemoryFeedbackRepository(),
      new InMemoryIdempotencyStore<unknown>(),
      normalRestDecisionProvider,
      { llmTimeoutMs: config.LLM_TIMEOUT_MS }
    ),
    demoRest: new RestService(
      demoAgent,
      content,
      new InMemoryFeedbackRepository(),
      new InMemoryIdempotencyStore<unknown>(),
      demoRestDecisionProvider,
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
    inbox,
    demoInbox,
    connectorHost,
    providerHealth: async () => ({
      agent: await realAgent.health(),
      rest_decision: await normalRestDecisionProvider.health(),
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

function graphOrigin(
  ...providers: Array<{ dataOrigin?: DataOrigin }>
): DataOrigin {
  return providers.every((provider) => provider.dataOrigin === "real")
    ? "real"
    : "mock";
}
