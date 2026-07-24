import type {
  FatigueCheckIn,
  FatigueReflection,
  HandoffJob,
  HandoffJobState,
  HandoffStartRequest,
  RestFeedback,
  RestQuest,
  RestQuestRecommendation,
  RestRecommendationRequest
} from "./contracts.js";

export interface MailFetchContext {
  accountId: string | null;
  since: string;
  maxItems: number;
}

export interface MailItem {
  id: string;
  threadId: string | null;
  from: string;
  replyTo: string | null;
  subject: string;
  receivedAt: string;
  plainText: string;
}

export interface DraftRequest {
  forItemId: string;
  threadId: string | null;
  to: string;
  subject: string;
  bodyText: string;
  dedupeKey: string;
}

export interface DraftResult {
  draftId: string;
}

export interface ProviderCallOptions {
  signal?: AbortSignal;
}

export interface MailProvider {
  readonly dataOrigin?: DataOrigin;
  health(): Promise<ProviderHealth>;
  fetchUnread(
    context: MailFetchContext,
    options?: ProviderCallOptions
  ): Promise<MailItem[]>;
  createDraft(
    request: DraftRequest,
    options?: ProviderCallOptions
  ): Promise<DraftResult>;
}

export interface MessagingChannel {
  readonly dataOrigin?: DataOrigin;
  health(): Promise<ProviderHealth>;
  send(
    message: OutboundMessage,
    options?: ProviderCallOptions
  ): Promise<void>;
}

export interface OutboundMessage {
  recipientId: string;
  text: string;
  correlationId: string;
}

export interface InboundMessage {
  eventId: string;
  providerMessageId: string;
  senderId: string;
  recipientId: string;
  text: string;
  receivedAt: string;
}

export interface InboundMessageMapper<Payload = unknown> {
  map(payload: Payload): InboundMessage;
}

export interface InboundEventDeduplicator {
  claim(eventId: string, ttlSeconds: number): Promise<boolean>;
}

export type ProviderHealth =
  | "ready"
  | "degraded"
  | "unavailable"
  | "unknown";

export type DataOrigin = "real" | "mock" | "cached";

export interface AgentLLM {
  readonly dataOrigin?: DataOrigin;
  health(): Promise<ProviderHealth>;
  reflectFatigue(
    input: FatigueCheckIn,
    options?: ProviderCallOptions
  ): Promise<FatigueReflection>;
  chooseQuest(
    input: RestRecommendationRequest,
    allowedQuests: RestQuest[],
    options?: ProviderCallOptions
  ): Promise<RestQuestRecommendation>;
  summarizeHandoff(
    input: HandoffAgentInput,
    options?: ProviderCallOptions
  ): Promise<HandoffSummaryDraft>;
}

export interface HandoffAgentInput {
  request: HandoffStartRequest;
  mail: MailItem[];
  mailAvailable: boolean;
}

export type HandoffPriority =
  | "tonight_required"
  | "tomorrow"
  | "no_action"
  | "uncertain";

export interface ClassifiedMail {
  id: string;
  priority: HandoffPriority;
  gist: string;
  reason: string;
  suggestedDraft: string | null;
}

export interface HandoffSummaryDraft {
  classifications: ClassifiedMail[];
  tomorrowFirstStep: string | null;
}

export interface RestContentRepository {
  contentVersion(): string;
  quests(): RestQuest[];
  questById(id: string): RestQuest | undefined;
}

export interface HandoffJobRecord {
  job: HandoffJob;
  request: HandoffStartRequest;
  state: HandoffJobState;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  cancelled: boolean;
}

export interface HandoffJobRepository {
  create(record: HandoffJobRecord): Promise<void>;
  get(id: string): Promise<HandoffJobRecord | null>;
  transition(
    id: string,
    input: HandoffJobTransition
  ): Promise<HandoffJobTransitionResult>;
  deleteExpired(before: string): Promise<number>;
}

export interface HandoffJobTransition {
  expectedStatuses: HandoffJobState["status"][];
  nextState: HandoffJobState;
  updatedAt: string;
}

export type HandoffJobTransitionResult =
  | { kind: "updated"; record: HandoffJobRecord }
  | { kind: "status_mismatch"; record: HandoffJobRecord }
  | { kind: "not_found" };

export interface IdempotencyStore<T = unknown> {
  claimOrGet(input: IdempotencyClaimInput<T>): Promise<IdempotencyClaimResult<T>>;
  deleteExpired(before: string): Promise<number>;
}

export interface IdempotencyClaimInput<T> {
  key: string;
  requestHash: string;
  ttlSeconds: number;
  create(): Promise<T>;
}

export type IdempotencyClaimResult<T> =
  | { kind: "created"; value: T }
  | { kind: "existing_same_request"; value: T }
  | { kind: "conflict_different_request" };

export interface FeedbackRepository {
  record(feedback: RestFeedback): Promise<void>;
}

export interface HandoffCompletionSink {
  readonly dataOrigin?: DataOrigin;
  notify(
    record: HandoffJobRecord,
    options?: ProviderCallOptions
  ): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(prefix: string): string;
}
