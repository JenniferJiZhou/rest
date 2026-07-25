import { randomUUID } from "node:crypto";
import type {
  InboxDraft,
  InboxEvent,
  InboxProvider,
  InboxSendResult,
  InboxSummaryResult,
  InboxSyncStatus,
  UnifiedInboxItem
} from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type {
  IdempotencyClaimInput,
  IdempotencyClaimResult,
  IdempotencyStore
} from "../domain/ports.js";
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
import {
  InMemoryInboxStateBackend,
  type InboxPersistedState,
  type InboxStateBackend
} from "./state-backend.js";

export class InMemoryInboxRepository implements InboxRepository {
  constructor(
    private readonly backend: InboxStateBackend =
      new InMemoryInboxStateBackend()
  ) {}

  async upsert(
    event: InboxEvent,
    now: string = new Date().toISOString()
  ): Promise<{
    item: UnifiedInboxItem;
    created: boolean;
    changed: boolean;
  }> {
    return this.backend.mutate<{
      item: UnifiedInboxItem;
      created: boolean;
      changed: boolean;
    }>((state) => {
      const dedupeKey = this.dedupeKey(event);
      const existingId = state.dedupe_item_ids[dedupeKey];
      if (existingId) {
        return {
          state,
          value: {
            item: state.items[existingId]!,
            created: false,
            changed: false
          }
        };
      }

      const normalizedEvent = structuredClone(event);
      const isGroupConversation =
        normalizedEvent.conversation_type === "group";
      let sealNewDigest =
        isGroupConversation && normalizedEvent.conversation_id === null;
      if (
        isGroupConversation &&
        normalizedEvent.conversation_id !== null
      ) {
        const digestKey = this.digestKey(normalizedEvent);
        const openId = state.open_digest_ids[digestKey];
        if (openId) {
          const current = state.items[openId]!;
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
            this.sealOpenDigest(state, digestKey, current, now);
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
            state.items[openId] = updated;
            state.dedupe_item_ids[dedupeKey] = openId;
            state.source_messages[openId]!.push(
              this.sourceMessage(normalizedEvent)
            );
            this.sortSourceMessages(state, openId);
            if (reachesMessageLimit) {
              delete state.open_digest_ids[digestKey];
            }
            return {
              state,
              value: {
                item: updated,
                created: false,
                changed: true
              }
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
      state.items[item.id] = item;
      state.dedupe_item_ids[dedupeKey] = item.id;
      state.source_messages[item.id] = [
        this.sourceMessage(normalizedEvent)
      ];
      if (
        isGroupConversation &&
        normalizedEvent.conversation_id !== null &&
        !sealNewDigest
      ) {
        state.open_digest_ids[this.digestKey(normalizedEvent)] = item.id;
      }
      return {
        state,
        value: {
          item,
          created: true,
          changed: true
        }
      };
    });
  }

  async get(id: string): Promise<UnifiedInboxItem | null> {
    return this.backend.read((state) => state.items[id] ?? null);
  }

  async list(input: {
    cursor?: string;
    limit: number;
  }): Promise<{ items: UnifiedInboxItem[]; nextCursor: string | null }> {
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    return this.backend.read((state) => {
      const sorted = Object.values(state.items).sort((left, right) =>
        right.received_at.localeCompare(left.received_at)
      );
      const items = sorted.slice(start, start + input.limit);
      const nextOffset = start + items.length;
      return {
        items,
        nextCursor:
          nextOffset < sorted.length ? String(nextOffset) : null
      };
    });
  }

  async recoveryCandidates(): Promise<UnifiedInboxItem[]> {
    return this.backend.read((state) =>
      Object.values(state.items).filter(
        (item) =>
          item.sync_status === "pending" ||
          (item.sync_status === "ready" &&
            item.needs_reply === true &&
            item.draft_id === null)
      )
    );
  }

  async saveEnrichment(
    id: string,
    expectedRevision: number,
    enrichment: InboxSummaryResult
  ): Promise<UnifiedInboxItem> {
    return this.backend.mutate((state) => {
      const item = this.requireItem(state, id);
      if (item.revision !== expectedRevision) {
        throw revisionConflict(item.revision);
      }
      const updated: UnifiedInboxItem = {
        ...item,
        ...structuredClone(enrichment),
        sync_status: "ready"
      };
      state.items[id] = updated;
      return { state, value: updated };
    });
  }

  async sourceMessages(id: string): Promise<InboxSourceMessage[]> {
    return this.backend.read((state) => {
      this.requireItem(state, id);
      return state.source_messages[id] ?? [];
    });
  }

  async markEnrichmentFailed(
    id: string,
    expectedRevision: number,
    _reason: string
  ): Promise<UnifiedInboxItem> {
    return this.backend.mutate((state) => {
      const item = this.requireItem(state, id);
      if (item.revision !== expectedRevision) {
        throw revisionConflict(item.revision);
      }
      const updated: UnifiedInboxItem = {
        ...item,
        sync_status: "failed"
      };
      state.items[id] = updated;
      return { state, value: updated };
    });
  }

  async setDraftId(
    id: string,
    expectedRevision: number,
    draftId: string
  ): Promise<UnifiedInboxItem> {
    return this.backend.mutate((state) => {
      const item = this.requireItem(state, id);
      if (item.revision !== expectedRevision) {
        throw revisionConflict(item.revision);
      }
      if (item.draft_id !== null) {
        if (item.draft_id === draftId) {
          return { state, value: item };
        }
        throw revisionConflict(item.revision);
      }
      const updated = { ...item, draft_id: draftId };
      state.items[id] = updated;
      return { state, value: updated };
    });
  }

  async acknowledge(
    id: string,
    expectedRevision: number,
    now: string = new Date().toISOString()
  ): Promise<UnifiedInboxItem> {
    return this.backend.mutate((state) => {
      const item = this.requireItem(state, id);
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
      state.items[id] = updated;
      if (item.conversation_type === "group") {
        const digestKey = this.digestKey(item);
        if (state.open_digest_ids[digestKey] === id) {
          delete state.open_digest_ids[digestKey];
        }
      }
      return { state, value: updated };
    });
  }

  private requireItem(
    state: Readonly<InboxPersistedState>,
    id: string
  ): UnifiedInboxItem {
    const item = state.items[id];
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
    state: InboxPersistedState,
    digestKey: string,
    item: UnifiedInboxItem,
    now: string
  ): void {
    state.items[item.id] = { ...item, sealed_at: now };
    delete state.open_digest_ids[digestKey];
  }

  private sortSourceMessages(
    state: InboxPersistedState,
    id: string
  ): void {
    state.source_messages[id]!.sort((left, right) => {
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
  constructor(
    private readonly backend: InboxStateBackend =
      new InMemoryInboxStateBackend()
  ) {}

  async bindAll(bindings: InboxParticipantBinding[]): Promise<void> {
    await this.backend.mutate((state) => {
      for (const binding of bindings) {
        state.participant_bindings[
          this.key(
            binding.provider,
            binding.accountId,
            binding.conversationId,
            binding.participantRef
          )
        ] = structuredClone(binding);
      }
      return { state, value: undefined };
    });
  }

  async resolve(input: {
    provider: InboxProvider;
    accountId: string;
    conversationId: string;
    participantRefs: string[];
  }): Promise<ResolvedInboxParticipant[]> {
    return this.backend.read((state) => {
      return input.participantRefs.map((participantRef) => {
        const binding =
          state.participant_bindings[
            this.key(
              input.provider,
              input.accountId,
              input.conversationId,
              participantRef
            )
          ];
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
  constructor(
    private readonly backend: InboxStateBackend =
      new InMemoryInboxStateBackend()
  ) {}

  async create(input: CreateInboxDraft): Promise<InboxDraft> {
    return this.backend.mutate((state) => {
      const existing = state.drafts[input.id];
      if (existing) {
        return { state, value: existing };
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
      state.drafts[draft.id] = draft;
      return { state, value: draft };
    });
  }

  async get(id: string): Promise<InboxDraft | null> {
    return this.backend.read((state) => state.drafts[id] ?? null);
  }

  async update(
    id: string,
    input: UpdateInboxDraft
  ): Promise<InboxDraft> {
    return this.backend.mutate((state) => {
      const draft = this.requireDraft(state, id);
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
      state.drafts[id] = updated;
      return { state, value: updated };
    });
  }

  async claimForSend(
    id: string,
    expectedVersion: number,
    now: string
  ): Promise<InboxDraft> {
    return this.backend.mutate((state) => {
      const draft = this.requireDraft(state, id);
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
      state.drafts[id] = updated;
      return { state, value: updated };
    });
  }

  async transition(
    id: string,
    input: TransitionInboxDraft
  ): Promise<InboxDraft> {
    return this.backend.mutate((state) => {
      const draft = this.requireDraft(state, id);
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
      state.drafts[id] = updated;
      return { state, value: updated };
    });
  }

  async recoverSending(now: string): Promise<number> {
    return this.backend.mutate((state) => {
      let recovered = 0;
      for (const [id, draft] of Object.entries(state.drafts)) {
        if (draft.status !== "sending") {
          continue;
        }
        state.drafts[id] = {
          ...draft,
          status: "unknown",
          provider_draft_id: null,
          updated_at: now
        };
        recovered += 1;
      }
      return { state, value: recovered };
    });
  }

  private requireDraft(
    state: Readonly<InboxPersistedState>,
    id: string
  ): InboxDraft {
    const draft = state.drafts[id];
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
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly backend: InboxStateBackend =
      new InMemoryInboxStateBackend()
  ) {}

  async get(
    provider: InboxProvider,
    accountId: string
  ): Promise<string | null> {
    return this.backend.mutate((state) => {
      const record = this.ensure(state, provider, accountId);
      return { state, value: record.checkpoint };
    });
  }

  async put(
    provider: InboxProvider,
    accountId: string,
    checkpoint: string
  ): Promise<void> {
    await this.backend.mutate((state) => {
      const record = this.ensure(state, provider, accountId);
      state.checkpoints[this.key(provider, accountId)] = {
        ...record,
        status: "ready",
        checkpoint,
        last_synced_at: this.now().toISOString(),
        last_error: null
      };
      return { state, value: undefined };
    });
  }

  async statuses(): Promise<InboxSyncStatus[]> {
    return this.backend.read((state) => Object.values(state.checkpoints));
  }

  async recordFailure(
    provider: InboxProvider,
    accountId: string,
    reason: string
  ): Promise<void> {
    await this.backend.mutate((state) => {
      const record = this.ensure(state, provider, accountId);
      state.checkpoints[this.key(provider, accountId)] = {
        ...record,
        status: "degraded",
        last_error: reason
      };
      return { state, value: undefined };
    });
  }

  private ensure(
    state: InboxPersistedState,
    provider: InboxProvider,
    accountId: string
  ): CheckpointRecord {
    const key = this.key(provider, accountId);
    const existing = state.checkpoints[key];
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
    state.checkpoints[key] = created;
    return created;
  }

  private key(provider: InboxProvider, accountId: string): string {
    return JSON.stringify([provider, accountId]);
  }
}

interface InFlightSendClaim {
  requestHash: string;
  value: Promise<IdempotencyClaimResult<InboxSendResult>>;
}

export class InboxSendIdempotencyStore
  implements IdempotencyStore<InboxSendResult>
{
  private readonly inFlight = new Map<string, InFlightSendClaim>();

  constructor(
    private readonly backend: InboxStateBackend =
      new InMemoryInboxStateBackend(),
    private readonly now: () => number = () => Date.now()
  ) {}

  async claimOrGet(
    input: IdempotencyClaimInput<InboxSendResult>
  ): Promise<IdempotencyClaimResult<InboxSendResult>> {
    const existingInFlight = this.inFlight.get(input.key);
    if (existingInFlight) {
      if (existingInFlight.requestHash !== input.requestHash) {
        return { kind: "conflict_different_request" };
      }
      const result = await existingInFlight.value;
      return result.kind === "created"
        ? { kind: "existing_same_request", value: result.value }
        : result;
    }

    const value = this.claimOrCreate(input);
    const claim = {
      requestHash: input.requestHash,
      value
    };
    this.inFlight.set(input.key, claim);
    try {
      return await value;
    } finally {
      if (this.inFlight.get(input.key) === claim) {
        this.inFlight.delete(input.key);
      }
    }
  }

  async deleteExpired(before: string): Promise<number> {
    const threshold = Date.parse(before);
    return this.backend.mutate((state) => {
      let deleted = 0;
      for (const [key, claim] of Object.entries(
        state.completed_send_claims
      )) {
        if (Date.parse(claim.expires_at) <= threshold) {
          delete state.completed_send_claims[key];
          deleted += 1;
        }
      }
      return { state, value: deleted };
    });
  }

  private async claimOrCreate(
    input: IdempotencyClaimInput<InboxSendResult>
  ): Promise<IdempotencyClaimResult<InboxSendResult>> {
    const claimKey = this.claimKey(input.key);
    const now = this.now();
    const existing = await this.backend.read(
      (state) => state.completed_send_claims[claimKey]
    );
    if (existing && Date.parse(existing.expires_at) > now) {
      if (existing.request_hash !== input.requestHash) {
        return { kind: "conflict_different_request" };
      }
      return {
        kind: "existing_same_request",
        value: existing.result
      };
    }
    if (existing) {
      await this.backend.mutate((state) => {
        const current = state.completed_send_claims[claimKey];
        if (
          current &&
          Date.parse(current.expires_at) <= now
        ) {
          delete state.completed_send_claims[claimKey];
        }
        return { state, value: undefined };
      });
    }

    const result = await input.create();
    const expiresAt = new Date(
      this.now() + input.ttlSeconds * 1_000
    ).toISOString();
    await this.backend.mutate((state) => {
      state.completed_send_claims[claimKey] = {
        request_hash: input.requestHash,
        result,
        expires_at: expiresAt
      };
      return { state, value: undefined };
    });
    return { kind: "created", value: result };
  }

  private claimKey(key: string): string {
    return JSON.stringify([key]);
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
