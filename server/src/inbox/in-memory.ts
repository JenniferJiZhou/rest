import { randomUUID } from "node:crypto";
import type {
  InboxDraft,
  InboxEvent,
  InboxProvider,
  InboxSyncStatus,
  UnifiedInboxItem
} from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import type {
  CheckpointStore,
  CreateInboxDraft,
  InboxDraftRepository,
  InboxRepository,
  TransitionInboxDraft,
  UpdateInboxDraft
} from "./ports.js";

export class InMemoryInboxRepository implements InboxRepository {
  private readonly items = new Map<string, UnifiedInboxItem>();
  private readonly idsByDedupeKey = new Map<string, string>();

  async upsert(
    event: InboxEvent
  ): Promise<{ item: UnifiedInboxItem; created: boolean }> {
    const key = [
      event.provider,
      event.account_id,
      event.provider_message_id
    ].join("\u0000");
    const existingId = this.idsByDedupeKey.get(key);
    if (existingId) {
      return {
        item: structuredClone(this.items.get(existingId)!),
        created: false
      };
    }

    const item: UnifiedInboxItem = {
      id: `inbox_${randomUUID()}`,
      ...structuredClone(event),
      summary: null,
      important_points: [],
      todos: [],
      priority: "uncertain",
      needs_reply: null,
      draft_id: null,
      sync_status: "pending"
    };
    this.items.set(item.id, item);
    this.idsByDedupeKey.set(key, item.id);
    return { item: structuredClone(item), created: true };
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
    enrichment: {
      summary: string;
      important_points: string[];
      todos: string[];
      priority: UnifiedInboxItem["priority"];
      needs_reply: boolean;
    }
  ): Promise<UnifiedInboxItem> {
    const item = this.requireItem(id);
    const updated: UnifiedInboxItem = {
      ...item,
      ...structuredClone(enrichment),
      sync_status: "ready"
    };
    this.items.set(id, updated);
    return structuredClone(updated);
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
    return `${provider}\u0000${accountId}`;
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

function statusConflict(currentStatus: InboxDraft["status"]): AppError {
  return new AppError({
    code: "INBOX_VERSION_CONFLICT",
    message: "草稿状态已发生变化，请刷新后重试。",
    statusCode: 409,
    details: { current_status: currentStatus }
  });
}
