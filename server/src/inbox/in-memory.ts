import { randomUUID } from "node:crypto";
import type {
  InboxDraft,
  InboxEvent,
  InboxProvider,
  InboxSummaryResult,
  InboxSyncStatus,
  UnifiedInboxItem
} from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type {
  CheckpointStore,
  CreateInboxDraft,
  InboxDraftRepository,
  InboxParticipantBinding,
  InboxParticipantDirectory,
  InboxRepository,
  InboxSourceMessage,
  ResolvedInboxParticipant,
  TransitionInboxDraft,
  UpdateInboxDraft
} from "./ports.js";

export class InMemoryInboxRepository implements InboxRepository {
  private readonly items = new Map<string, UnifiedInboxItem>();
  private readonly idsByDedupeKey = new Map<string, string>();
  private readonly openDigestIds = new Map<string, string>();
  private readonly sourceMessagesByItemId = new Map<
    string,
    InboxSourceMessage[]
  >();

  async upsert(
    event: InboxEvent,
    now: string = new Date().toISOString()
  ): Promise<{
    item: UnifiedInboxItem;
    created: boolean;
    changed: boolean;
  }> {
    const dedupeKey = this.dedupeKey(event);
    const existingId = this.idsByDedupeKey.get(dedupeKey);
    if (existingId) {
      return {
        item: structuredClone(this.items.get(existingId)!),
        created: false,
        changed: false
      };
    }

    const normalizedEvent = structuredClone(event);
    const isGroupConversation = normalizedEvent.conversation_type === "group";
    let sealNewDigest =
      isGroupConversation && normalizedEvent.conversation_id === null;
    if (isGroupConversation && normalizedEvent.conversation_id !== null) {
      const digestKey = this.digestKey(normalizedEvent);
      const openId = this.openDigestIds.get(digestKey);
      if (openId) {
        const current = this.items.get(openId)!;
        const eventTime = Date.parse(normalizedEvent.received_at);
        const currentStartTime = Date.parse(current.window_started_at);
        const currentEndTime = Date.parse(current.window_ended_at);
        const candidateStartTime = Math.min(currentStartTime, eventTime);
        const candidateEndTime = Math.max(currentEndTime, eventTime);
        const reachesTimeLimit =
          candidateEndTime - candidateStartTime >=
          24 * 60 * 60 * 1_000;
        if (reachesTimeLimit && eventTime < currentStartTime) {
          sealNewDigest = true;
        } else if (reachesTimeLimit) {
          this.sealOpenDigest(digestKey, current, now);
        } else {
          const messageCount = current.message_count + 1;
          const reachesMessageLimit = messageCount >= 1_000;
          const eventIsLatest =
            eventTime > currentEndTime ||
            (eventTime === currentEndTime &&
              normalizedEvent.provider_message_id >
                current.provider_message_id);
          const updated: UnifiedInboxItem = {
            ...current,
            provider_message_id: eventIsLatest
              ? normalizedEvent.provider_message_id
              : current.provider_message_id,
            received_at: eventIsLatest
              ? normalizedEvent.received_at
              : current.received_at,
            revision: current.revision + 1,
            message_count: messageCount,
            window_started_at:
              eventTime < currentStartTime
                ? normalizedEvent.received_at
                : current.window_started_at,
            window_ended_at:
              eventTime > currentEndTime
                ? normalizedEvent.received_at
                : current.window_ended_at,
            sealed_at: reachesMessageLimit ? now : null,
            summary: null,
            important_points: [],
            todos: [],
            priority: "uncertain",
            needs_reply: null,
            reply_targets: [],
            draft_id: null,
            sync_status: "pending"
          };
          this.items.set(openId, updated);
          this.idsByDedupeKey.set(dedupeKey, openId);
          this.sourceMessagesByItemId
            .get(openId)!
            .push(this.sourceMessage(normalizedEvent));
          this.sortSourceMessages(openId);
          if (reachesMessageLimit) {
            this.openDigestIds.delete(digestKey);
          }
          return {
            item: structuredClone(updated),
            created: false,
            changed: true
          };
        }
      }
    }

    const item: UnifiedInboxItem = {
      id: `inbox_${randomUUID()}`,
      ...normalizedEvent,
      sender: isGroupConversation ? null : normalizedEvent.sender,
      sender_ref: isGroupConversation ? null : normalizedEvent.sender_ref,
      content: isGroupConversation ? null : normalizedEvent.content,
      item_kind: isGroupConversation ? "conversation_digest" : "message",
      revision: 1,
      message_count: 1,
      window_started_at: event.received_at,
      window_ended_at: event.received_at,
      sealed_at: sealNewDigest ? now : null,
      acknowledged_at: null,
      summary: null,
      important_points: [],
      todos: [],
      priority: "uncertain",
      needs_reply: null,
      reply_targets: [],
      draft_id: null,
      sync_status: "pending"
    };
    this.items.set(item.id, item);
    this.idsByDedupeKey.set(dedupeKey, item.id);
    this.sourceMessagesByItemId.set(item.id, [
      this.sourceMessage(normalizedEvent)
    ]);
    if (
      isGroupConversation &&
      normalizedEvent.conversation_id !== null &&
      !sealNewDigest
    ) {
      this.openDigestIds.set(this.digestKey(normalizedEvent), item.id);
    }
    return {
      item: structuredClone(item),
      created: true,
      changed: true
    };
  }

  async get(id: string): Promise<UnifiedInboxItem | null> {
    const item = this.items.get(id);
    return item ? structuredClone(item) : null;
  }

  async list(input: {
    cursor?: string;
    limit: number;
  }): Promise<{ items: UnifiedInboxItem[]; nextCursor: string | null }> {
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const sorted = [...this.items.values()].sort((left, right) =>
      right.received_at.localeCompare(left.received_at)
    );
    const items = sorted.slice(start, start + input.limit);
    const nextOffset = start + items.length;
    return {
      items: structuredClone(items),
      nextCursor:
        nextOffset < sorted.length ? String(nextOffset) : null
    };
  }

  async saveEnrichment(
    id: string,
    expectedRevision: number,
    enrichment: InboxSummaryResult
  ): Promise<UnifiedInboxItem> {
    const item = this.requireItem(id);
    if (item.revision !== expectedRevision) {
      throw revisionConflict(item.revision);
    }
    const updated: UnifiedInboxItem = {
      ...item,
      ...structuredClone(enrichment),
      sync_status: "ready"
    };
    this.items.set(id, updated);
    return structuredClone(updated);
  }

  async sourceMessages(id: string): Promise<InboxSourceMessage[]> {
    this.requireItem(id);
    return structuredClone(this.sourceMessagesByItemId.get(id) ?? []);
  }

  async setDraftId(
    id: string,
    draftId: string
  ): Promise<UnifiedInboxItem> {
    const item = this.requireItem(id);
    const updated = { ...item, draft_id: draftId };
    this.items.set(id, updated);
    return structuredClone(updated);
  }

  async acknowledge(
    id: string,
    expectedRevision: number,
    now: string = new Date().toISOString()
  ): Promise<UnifiedInboxItem> {
    const item = this.requireItem(id);
    if (
      item.revision !== expectedRevision ||
      item.acknowledged_at !== null ||
      item.sealed_at !== null
    ) {
      throw revisionConflict(item.revision);
    }
    const updated: UnifiedInboxItem = {
      ...item,
      acknowledged_at: now,
      sealed_at: now
    };
    this.items.set(id, updated);
    if (item.conversation_type === "group") {
      const digestKey = this.digestKey(item);
      if (this.openDigestIds.get(digestKey) === id) {
        this.openDigestIds.delete(digestKey);
      }
    }
    return structuredClone(updated);
  }

  private requireItem(id: string): UnifiedInboxItem {
    const item = this.items.get(id);
    if (!item) {
      throw new AppError({
        code: "INBOX_ITEM_NOT_FOUND",
        message: "未找到收件箱项目。",
        statusCode: 404
      });
    }
    return item;
  }

  private dedupeKey(event: InboxEvent): string {
    return JSON.stringify([
      event.provider,
      event.account_id,
      event.provider_message_id
    ]);
  }

  private digestKey(
    event: Pick<
      InboxEvent,
      "provider" | "account_id" | "conversation_id"
    >
  ): string {
    return JSON.stringify([
      event.provider,
      event.account_id,
      event.conversation_id
    ]);
  }

  private sourceMessage(event: InboxEvent): InboxSourceMessage {
    return {
      providerMessageId: event.provider_message_id,
      senderRef: event.sender_ref,
      senderDisplayName: event.sender,
      content: event.content,
      receivedAt: event.received_at
    };
  }

  private sealOpenDigest(
    digestKey: string,
    item: UnifiedInboxItem,
    now: string
  ): void {
    this.items.set(item.id, { ...item, sealed_at: now });
    this.openDigestIds.delete(digestKey);
  }

  private sortSourceMessages(id: string): void {
    this.sourceMessagesByItemId.get(id)!.sort((left, right) => {
      const receivedOrder =
        Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
      if (receivedOrder !== 0) {
        return receivedOrder;
      }
      if (left.providerMessageId < right.providerMessageId) {
        return -1;
      }
      if (left.providerMessageId > right.providerMessageId) {
        return 1;
      }
      return 0;
    });
  }
}

export class InMemoryInboxParticipantDirectory
  implements InboxParticipantDirectory
{
  private readonly bindings = new Map<
    string,
    InboxParticipantBinding
  >();

  async bindAll(bindings: InboxParticipantBinding[]): Promise<void> {
    for (const binding of bindings) {
      this.bindings.set(
        this.key(
          binding.provider,
          binding.accountId,
          binding.conversationId,
          binding.participantRef
        ),
        structuredClone(binding)
      );
    }
  }

  async resolve(input: {
    provider: InboxProvider;
    accountId: string;
    conversationId: string;
    participantRefs: string[];
  }): Promise<ResolvedInboxParticipant[]> {
    return input.participantRefs.map((participantRef) => {
      const binding = this.bindings.get(
        this.key(
          input.provider,
          input.accountId,
          input.conversationId,
          participantRef
        )
      );
      if (!binding) {
        throw new AppError({
          code: "INBOX_VERSION_CONFLICT",
          message: "回复目标已发生变化，请刷新后重试。",
          statusCode: 409
        });
      }
      return {
        participantRef: binding.participantRef,
        providerParticipantId: binding.providerParticipantId,
        displayName: binding.displayName
      };
    });
  }

  private key(
    provider: InboxProvider,
    accountId: string,
    conversationId: string,
    participantRef: string
  ): string {
    return JSON.stringify([
      provider,
      accountId,
      conversationId,
      participantRef
    ]);
  }
}

export class InMemoryInboxDraftRepository
  implements InboxDraftRepository
{
  private readonly drafts = new Map<string, InboxDraft>();

  async create(input: CreateInboxDraft): Promise<InboxDraft> {
    const existing = this.drafts.get(input.id);
    if (existing) {
      return structuredClone(existing);
    }
    const draft: InboxDraft = {
      id: input.id,
      inbox_item_id: input.inboxItemId,
      content: input.content,
      content_type: input.contentType,
      version: 1,
      origin: "ai",
      status: "ready",
      provider_draft_id: null,
      created_at: input.now,
      updated_at: input.now
    };
    this.drafts.set(draft.id, draft);
    return structuredClone(draft);
  }

  async get(id: string): Promise<InboxDraft | null> {
    const draft = this.drafts.get(id);
    return draft ? structuredClone(draft) : null;
  }

  async update(
    id: string,
    input: UpdateInboxDraft
  ): Promise<InboxDraft> {
    const draft = this.requireDraft(id);
    if (!["ready", "edited", "failed"].includes(draft.status)) {
      throw statusConflict(draft.status);
    }
    if (draft.version !== input.expectedVersion) {
      throw versionConflict(draft.version);
    }
    const updated: InboxDraft = {
      ...draft,
      content: input.content,
      content_type: input.contentType,
      version: draft.version + 1,
      origin: "user",
      status: "edited",
      updated_at: new Date().toISOString()
    };
    this.drafts.set(id, updated);
    return structuredClone(updated);
  }

  async claimForSend(
    id: string,
    expectedVersion: number,
    now: string
  ): Promise<InboxDraft> {
    const draft = this.requireDraft(id);
    if (draft.version !== expectedVersion) {
      throw versionConflict(draft.version);
    }
    if (!["ready", "edited", "failed"].includes(draft.status)) {
      throw statusConflict(draft.status);
    }
    const updated: InboxDraft = {
      ...draft,
      status: "sending",
      updated_at: now
    };
    this.drafts.set(id, updated);
    return structuredClone(updated);
  }

  async transition(
    id: string,
    input: TransitionInboxDraft
  ): Promise<InboxDraft> {
    const draft = this.requireDraft(id);
    if (!input.expectedStatuses.includes(draft.status)) {
      throw new AppError({
        code: "INBOX_VERSION_CONFLICT",
        message: "草稿状态已发生变化，请刷新后重试。",
        statusCode: 409,
        details: { current_status: draft.status }
      });
    }
    const updated: InboxDraft = {
      ...draft,
      status: input.status,
      provider_draft_id:
        input.providerDraftId === undefined
          ? draft.provider_draft_id
          : input.providerDraftId,
      updated_at: input.now
    };
    this.drafts.set(id, updated);
    return structuredClone(updated);
  }

  private requireDraft(id: string): InboxDraft {
    const draft = this.drafts.get(id);
    if (!draft) {
      throw new AppError({
        code: "INBOX_DRAFT_NOT_FOUND",
        message: "未找到回复草稿。",
        statusCode: 404
      });
    }
    return draft;
  }
}

interface CheckpointRecord extends InboxSyncStatus {}

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly records = new Map<string, CheckpointRecord>();

  constructor(
    private readonly now: () => Date = () => new Date()
  ) {}

  async get(
    provider: InboxProvider,
    accountId: string
  ): Promise<string | null> {
    return this.ensure(provider, accountId).checkpoint;
  }

  async put(
    provider: InboxProvider,
    accountId: string,
    checkpoint: string
  ): Promise<void> {
    const record = this.ensure(provider, accountId);
    this.records.set(this.key(provider, accountId), {
      ...record,
      status: "ready",
      checkpoint,
      last_synced_at: this.now().toISOString(),
      last_error: null
    });
  }

  async statuses(): Promise<InboxSyncStatus[]> {
    return structuredClone([...this.records.values()]);
  }

  async recordFailure(
    provider: InboxProvider,
    accountId: string,
    reason: string
  ): Promise<void> {
    const record = this.ensure(provider, accountId);
    this.records.set(this.key(provider, accountId), {
      ...record,
      status: "degraded",
      last_error: reason
    });
  }

  private ensure(
    provider: InboxProvider,
    accountId: string
  ): CheckpointRecord {
    const key = this.key(provider, accountId);
    const existing = this.records.get(key);
    if (existing) {
      return existing;
    }
    const created: CheckpointRecord = {
      provider,
      account_id: accountId,
      status: "unknown",
      checkpoint: null,
      last_synced_at: null,
      last_error: null,
      coverage: {
        source: provider === "qq_mail" ? "imap" : "official_api",
        complete: false,
        note: "尚未完成首次同步"
      }
    };
    this.records.set(key, created);
    return created;
  }

  private key(provider: InboxProvider, accountId: string): string {
    return JSON.stringify([provider, accountId]);
  }
}

function versionConflict(currentVersion: number): AppError {
  return new AppError({
    code: "INBOX_VERSION_CONFLICT",
    message: "草稿版本已更新，请刷新后重试。",
    statusCode: 409,
    details: { current_version: currentVersion }
  });
}

function revisionConflict(currentRevision: number): AppError {
  return new AppError({
    code: "INBOX_VERSION_CONFLICT",
    message: "会话摘要版本已更新，请刷新后重试。",
    statusCode: 409,
    details: { current_revision: currentRevision }
  });
}

function statusConflict(currentStatus: InboxDraft["status"]): AppError {
  return new AppError({
    code: "INBOX_VERSION_CONFLICT",
    message: "草稿状态已发生变化，请刷新后重试。",
    statusCode: 409,
    details: { current_status: currentStatus }
  });
}
