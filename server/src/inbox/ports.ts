import type {
  InboxDraft,
  InboxDraftStatus,
  InboxEvent,
  InboxPriority,
  InboxProvider,
  InboxSendResult,
  InboxSummaryResult,
  InboxSyncStatus,
  UnifiedInboxItem
} from "../domain/contracts.js";
import type {
  DataOrigin,
  ProviderCallOptions,
  ProviderHealth
} from "../domain/ports.js";

export interface InboxRepository {
  upsert(
    event: InboxEvent,
    now?: string
  ): Promise<{
    item: UnifiedInboxItem;
    created: boolean;
    changed: boolean;
  }>;
  get(id: string): Promise<UnifiedInboxItem | null>;
  list(input: { cursor?: string; limit: number }): Promise<{
    items: UnifiedInboxItem[];
    nextCursor: string | null;
  }>;
  sourceMessages(id: string): Promise<InboxSourceMessage[]>;
  saveEnrichment(
    id: string,
    expectedRevision: number,
    enrichment: InboxSummaryResult
  ): Promise<UnifiedInboxItem>;
  setDraftId(id: string, draftId: string): Promise<UnifiedInboxItem>;
  acknowledge(
    id: string,
    expectedRevision: number,
    now?: string
  ): Promise<UnifiedInboxItem>;
}

export interface InboxParticipantBinding {
  provider: InboxProvider;
  accountId: string;
  conversationId: string;
  participantRef: string;
  providerParticipantId: string;
  displayName: string;
}

export interface ResolvedInboxParticipant {
  participantRef: string;
  providerParticipantId: string;
  displayName: string;
}

export interface InboxParticipantDirectory {
  bindAll(bindings: InboxParticipantBinding[]): Promise<void>;
  resolve(input: {
    provider: InboxProvider;
    accountId: string;
    conversationId: string;
    participantRefs: string[];
  }): Promise<ResolvedInboxParticipant[]>;
}

export interface InboxSourceMessage {
  providerMessageId: string;
  senderRef: string | null;
  senderDisplayName: string | null;
  content: string;
  receivedAt: string;
}

export interface CreateInboxDraft {
  id: string;
  inboxItemId: string;
  content: string;
  contentType: "text" | "html";
  now: string;
}

export interface UpdateInboxDraft {
  content: string;
  contentType: "text" | "html";
  expectedVersion: number;
}

export interface TransitionInboxDraft {
  expectedStatuses: InboxDraftStatus[];
  status: InboxDraftStatus;
  providerDraftId?: string | null;
  now: string;
}

export interface InboxDraftRepository {
  create(input: CreateInboxDraft): Promise<InboxDraft>;
  get(id: string): Promise<InboxDraft | null>;
  update(id: string, input: UpdateInboxDraft): Promise<InboxDraft>;
  claimForSend(
    id: string,
    expectedVersion: number,
    now: string
  ): Promise<InboxDraft>;
  transition(
    id: string,
    input: TransitionInboxDraft
  ): Promise<InboxDraft>;
}

export interface InboxSummaryInput {
  conversationName: string;
  allowedParticipants: InboxAllowedParticipant[];
  messages: InboxIntelligenceMessage[];
}

export interface InboxAllowedParticipant {
  participantRef: string;
  displayName: string;
}

export interface InboxIntelligenceMessage {
  participantRef: string | null;
  displayName: string | null;
  content: string;
  receivedAt: string;
}

export interface ReplyDraftInput extends InboxSummaryInput {
  summary: string;
  importantPoints: string[];
  todos: string[];
  priority: InboxPriority;
  needsReply: boolean;
  replyTargets: Array<{
    displayName: string;
    reason: string;
  }>;
}

export interface ReplyDraftResult {
  content: string;
  contentType: "text" | "html";
}

export interface InboxIntelligenceProvider {
  readonly dataOrigin?: DataOrigin;
  health(): Promise<ProviderHealth>;
  summarize(
    input: InboxSummaryInput,
    options?: ProviderCallOptions
  ): Promise<InboxSummaryResult>;
  draftReply(
    input: ReplyDraftInput,
    options?: ProviderCallOptions
  ): Promise<ReplyDraftResult>;
}

export interface InboxSendInput {
  draftId: string;
  inboxItemId: string;
  accountId: string;
  conversationId: string | null;
  providerMessageId: string;
  replyTo: string;
  recipients: string[];
  subject: string | null;
  content: string;
  contentType: "text" | "html";
  idempotencyKey: string;
}

export interface InboxSender {
  readonly provider: InboxProvider;
  readonly dataOrigin?: DataOrigin;
  health(): Promise<ProviderHealth>;
  send(
    input: InboxSendInput,
    options?: ProviderCallOptions
  ): Promise<InboxSendResult>;
}

export interface InboxSource {
  readonly provider: InboxProvider;
  readonly dataOrigin?: DataOrigin;
  health(): Promise<ProviderHealth>;
  pull(
    input: {
      accountId: string;
      checkpoint: string | null;
      limit: number;
    },
    options?: ProviderCallOptions
  ): Promise<{
    items: InboxEvent[];
    checkpoint: string;
    participantBindings: InboxParticipantBinding[];
  }>;
}

export interface CheckpointStore {
  get(
    provider: InboxProvider,
    accountId: string
  ): Promise<string | null>;
  put(
    provider: InboxProvider,
    accountId: string,
    checkpoint: string
  ): Promise<void>;
  statuses(): Promise<InboxSyncStatus[]>;
  recordFailure(
    provider: InboxProvider,
    accountId: string,
    reason: string
  ): Promise<void>;
}

export interface ConfirmationTokenStore {
  issue(
    draftId: string,
    version: number,
    principalId: string
  ): Promise<{ token: string; expiresAt: string }>;
  consume(
    token: string,
    draftId: string,
    version: number,
    principalId: string
  ): Promise<boolean>;
}
