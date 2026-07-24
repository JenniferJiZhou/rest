import type { RestFeedback } from "../domain/contracts.js";
import type {
  FeedbackRepository,
  HandoffJobRecord,
  HandoffJobRepository,
  HandoffJobTransition,
  HandoffJobTransitionResult,
  InboundEventDeduplicator,
  IdempotencyClaimInput,
  IdempotencyClaimResult,
  IdempotencyStore,
  UnifiedInboxConfirmationMutationResult,
  UnifiedInboxDraftMutationResult,
  UnifiedInboxRepository,
  UnifiedInboxSendClaimResult
} from "../domain/ports.js";
import type {
  UnifiedInboxConfirmation,
  UnifiedInboxDraft,
  UnifiedInboxItemDetail,
  UnifiedInboxItemSummary,
  UnifiedInboxListFilter,
  UnifiedInboxListPage,
  UnifiedInboxSnapshot
} from "../domain/unified-inbox.js";

interface ExpiringClaim<T> {
  requestHash: string;
  value: Promise<T>;
  expiresAt: number | null;
}

export class InMemoryIdempotencyStore<T>
  implements IdempotencyStore<T>
{
  private readonly values = new Map<string, ExpiringClaim<T>>();

  async claimOrGet(
    input: IdempotencyClaimInput<T>
  ): Promise<IdempotencyClaimResult<T>> {
    const now = Date.now();
    const existing = this.values.get(input.key);
    if (
      existing &&
      (existing.expiresAt === null || existing.expiresAt > now)
    ) {
      if (existing.requestHash !== input.requestHash) {
        return { kind: "conflict_different_request" };
      }
      return {
        kind: "existing_same_request",
        value: await existing.value
      };
    }
    if (existing) {
      this.values.delete(input.key);
    }

    const value = Promise.resolve().then(input.create);
    const claim: ExpiringClaim<T> = {
      requestHash: input.requestHash,
      value,
      expiresAt: null
    };
    this.values.set(input.key, claim);
    try {
      const created = await value;
      claim.expiresAt = Date.now() + input.ttlSeconds * 1_000;
      return { kind: "created", value: created };
    } catch (error) {
      if (this.values.get(input.key) === claim) {
        this.values.delete(input.key);
      }
      throw error;
    }
  }

  async deleteExpired(before: string): Promise<number> {
    const threshold = Date.parse(before);
    let deleted = 0;
    for (const [key, claim] of this.values) {
      if (
        claim.expiresAt !== null &&
        claim.expiresAt <= threshold
      ) {
        this.values.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}

export class InMemoryUnifiedInboxRepository
  implements UnifiedInboxRepository
{
  private readonly items = new Map<string, UnifiedInboxItemDetail>();
  private readonly drafts = new Map<string, UnifiedInboxDraft>();
  private readonly confirmations = new Map<
    string,
    UnifiedInboxConfirmation
  >();
  private initialized = false;

  async initialize(snapshot: UnifiedInboxSnapshot): Promise<void> {
    if (this.initialized) {
      return;
    }
    for (const item of snapshot.items) {
      this.items.set(item.id, structuredClone(item));
    }
    for (const draft of snapshot.drafts) {
      this.drafts.set(draft.id, structuredClone(draft));
    }
    this.initialized = true;
  }

  async list(
    filter: UnifiedInboxListFilter,
    offset: number,
    limit: number
  ): Promise<UnifiedInboxListPage> {
    const matching = [...this.items.values()]
      .filter(
        (item) =>
          (filter.source === undefined || item.source === filter.source) &&
          (filter.status === undefined || item.status === filter.status) &&
          (filter.needsReply === undefined ||
            item.needsReply === filter.needsReply)
      )
      .sort(
        (left, right) =>
          right.receivedAt.localeCompare(left.receivedAt) ||
          left.id.localeCompare(right.id)
      );
    const items = matching
      .slice(offset, offset + limit)
      .map(toSummary);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor:
        nextOffset < matching.length ? String(nextOffset) : null
    };
  }

  async getItem(id: string): Promise<UnifiedInboxItemDetail | null> {
    const item = this.items.get(id);
    return item ? structuredClone(item) : null;
  }

  async acknowledge(
    id: string,
    acknowledgedAt: string
  ): Promise<UnifiedInboxItemDetail | null> {
    const item = this.items.get(id);
    if (!item) {
      return null;
    }
    if (item.acknowledgedAt === null) {
      item.acknowledgedAt = acknowledgedAt;
    }
    item.isUnread = false;
    if (item.status === "open") {
      item.status = "acknowledged";
    }
    return structuredClone(item);
  }

  async getDraft(id: string): Promise<UnifiedInboxDraft | null> {
    const draft = this.drafts.get(id);
    return draft ? structuredClone(draft) : null;
  }

  async updateDraft(input: {
    id: string;
    expectedVersion: number;
    body?: string;
    discard: boolean;
    updatedAt: string;
  }): Promise<UnifiedInboxDraftMutationResult> {
    const draft = this.drafts.get(input.id);
    if (!draft) {
      return { kind: "not_found" };
    }
    if (draft.version !== input.expectedVersion) {
      return {
        kind: "version_conflict",
        draft: structuredClone(draft)
      };
    }
    if (
      draft.status === "discarded" ||
      draft.status === "sent" ||
      draft.status === "sending"
    ) {
      return { kind: "invalid_state", draft: structuredClone(draft) };
    }

    this.invalidateConfirmations(draft.id);
    draft.version += 1;
    draft.updatedAt = input.updatedAt;
    draft.confirmationState = "invalidated";
    if (input.discard) {
      draft.status = "discarded";
    } else {
      draft.body = input.body!;
      draft.status = "editing";
    }
    const item = this.items.get(draft.itemId);
    if (item) {
      item.status = input.discard ? "discarded" : "drafting";
    }
    return { kind: "updated", draft: structuredClone(draft) };
  }

  async createConfirmation(input: {
    draftId: string;
    expectedVersion: number;
    confirmation: UnifiedInboxConfirmation;
  }): Promise<UnifiedInboxConfirmationMutationResult> {
    const draft = this.drafts.get(input.draftId);
    if (!draft) {
      return { kind: "not_found" };
    }
    if (draft.version !== input.expectedVersion) {
      return {
        kind: "version_conflict",
        draft: structuredClone(draft)
      };
    }
    if (
      draft.status === "discarded" ||
      draft.status === "sent" ||
      draft.status === "sending"
    ) {
      return { kind: "invalid_state", draft: structuredClone(draft) };
    }
    this.invalidateConfirmations(draft.id);
    this.confirmations.set(
      input.confirmation.confirmationId,
      structuredClone(input.confirmation)
    );
    draft.status = "confirmed";
    draft.confirmationState = "confirmed";
    return {
      kind: "created",
      confirmation: structuredClone(input.confirmation),
      draft: structuredClone(draft)
    };
  }

  async claimSend(input: {
    draftId: string;
    expectedVersion: number;
    confirmationId: string;
    now: string;
  }): Promise<UnifiedInboxSendClaimResult> {
    const draft = this.drafts.get(input.draftId);
    if (!draft) {
      return { kind: "not_found" };
    }
    if (draft.version !== input.expectedVersion) {
      return {
        kind: "version_conflict",
        draft: structuredClone(draft)
      };
    }
    const confirmation = this.confirmations.get(input.confirmationId);
    if (!confirmation) {
      return { kind: "confirmation_missing" };
    }
    if (
      confirmation.draftId !== draft.id ||
      confirmation.itemId !== draft.itemId ||
      confirmation.draftVersion !== draft.version
    ) {
      return { kind: "confirmation_mismatch" };
    }
    if (Date.parse(confirmation.expiresAt) <= Date.parse(input.now)) {
      this.confirmations.delete(confirmation.confirmationId);
      draft.status = "editing";
      draft.confirmationState = "expired";
      return {
        kind: "confirmation_expired",
        draft: structuredClone(draft)
      };
    }
    if (draft.status !== "confirmed") {
      return { kind: "invalid_state", draft: structuredClone(draft) };
    }
    const item = this.items.get(draft.itemId);
    if (!item) {
      return { kind: "not_found" };
    }
    draft.status = "sending";
    draft.updatedAt = input.now;
    return {
      kind: "claimed",
      item: structuredClone(item),
      draft: structuredClone(draft),
      confirmation: structuredClone(confirmation)
    };
  }

  async completeSend(input: {
    draftId: string;
    expectedVersion: number;
    sentAt: string;
  }): Promise<UnifiedInboxDraftMutationResult> {
    const draft = this.drafts.get(input.draftId);
    if (!draft) {
      return { kind: "not_found" };
    }
    if (draft.version !== input.expectedVersion) {
      return {
        kind: "version_conflict",
        draft: structuredClone(draft)
      };
    }
    if (draft.status !== "sending") {
      return { kind: "invalid_state", draft: structuredClone(draft) };
    }
    draft.status = "sent";
    draft.confirmationState = "consumed";
    draft.sentAt = input.sentAt;
    draft.updatedAt = input.sentAt;
    const item = this.items.get(draft.itemId);
    if (item) {
      item.status = "sent";
      item.isUnread = false;
    }
    this.invalidateConfirmations(draft.id);
    return { kind: "updated", draft: structuredClone(draft) };
  }

  async releaseSend(input: {
    draftId: string;
    expectedVersion: number;
    updatedAt: string;
  }): Promise<void> {
    const draft = this.drafts.get(input.draftId);
    if (
      draft &&
      draft.version === input.expectedVersion &&
      draft.status === "sending"
    ) {
      draft.status = "confirmed";
      draft.confirmationState = "confirmed";
      draft.updatedAt = input.updatedAt;
    }
  }

  private invalidateConfirmations(draftId: string): void {
    for (const [id, confirmation] of this.confirmations) {
      if (confirmation.draftId === draftId) {
        this.confirmations.delete(id);
      }
    }
  }
}

function toSummary(
  item: UnifiedInboxItemDetail
): UnifiedInboxItemSummary {
  return {
    id: item.id,
    source: item.source,
    conversationName: item.conversationName,
    senderDisplayName: item.senderDisplayName,
    subject: item.subject,
    preview: item.preview,
    receivedAt: item.receivedAt,
    needsReply: item.needsReply,
    isUnread: item.isUnread,
    priority: item.priority,
    status: item.status,
    draftId: item.draftId
  };
}

export class InMemoryHandoffJobRepository
  implements HandoffJobRepository
{
  private readonly records = new Map<string, HandoffJobRecord>();

  async create(record: HandoffJobRecord): Promise<void> {
    if (this.records.has(record.job.job_id)) {
      throw new Error(`handoff Job already exists: ${record.job.job_id}`);
    }
    this.records.set(record.job.job_id, structuredClone(record));
  }

  async get(id: string): Promise<HandoffJobRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async transition(
    id: string,
    input: HandoffJobTransition
  ): Promise<HandoffJobTransitionResult> {
    const existing = this.records.get(id);
    if (!existing) {
      return { kind: "not_found" };
    }
    if (!input.expectedStatuses.includes(existing.state.status)) {
      return {
        kind: "status_mismatch",
        record: structuredClone(existing)
      };
    }
    if (
      !isAllowedTransition(
        existing.state.status,
        input.nextState.status
      )
    ) {
      throw new Error(
        `illegal Handoff status transition: ${existing.state.status} -> ${input.nextState.status}`
      );
    }
    if (!isValidStateStage(input.nextState)) {
      throw new Error(
        `illegal Handoff state: ${input.nextState.status}/${input.nextState.progress_stage}`
      );
    }
    const updated = structuredClone({
      ...existing,
      state: input.nextState,
      updatedAt: input.updatedAt,
      cancelled:
        input.nextState.status === "cancelled"
          ? true
          : existing.cancelled
    });
    this.records.set(id, updated);
    return { kind: "updated", record: structuredClone(updated) };
  }

  async deleteExpired(before: string): Promise<number> {
    const threshold = Date.parse(before);
    let deleted = 0;
    for (const [id, record] of this.records) {
      if (
        ["succeeded", "failed", "cancelled"].includes(
          record.state.status
        ) &&
        Date.parse(record.updatedAt) < threshold
      ) {
        this.records.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

function isValidStateStage(
  state: HandoffJobRecord["state"]
): boolean {
  if (state.status === "queued") {
    return state.progress_stage === "queued";
  }
  if (state.status === "running") {
    return [
      "fetching_mail",
      "classifying",
      "creating_drafts",
      "preparing_receipt"
    ].includes(state.progress_stage);
  }
  if (state.status === "succeeded") {
    return state.progress_stage === "completed";
  }
  return state.progress_stage === state.status;
}

function isAllowedTransition(
  current: HandoffJobRecord["state"]["status"],
  next: HandoffJobRecord["state"]["status"]
): boolean {
  if (current === "queued") {
    return next === "running" || next === "cancelled";
  }
  if (current === "running") {
    return (
      next === "running" ||
      next === "succeeded" ||
      next === "failed" ||
      next === "cancelled"
    );
  }
  return current === next;
}

export class InMemoryFeedbackRepository implements FeedbackRepository {
  private readonly feedback: RestFeedback[] = [];

  async record(feedback: RestFeedback): Promise<void> {
    this.feedback.push(structuredClone(feedback));
  }

  all(): RestFeedback[] {
    return structuredClone(this.feedback);
  }
}

export class InMemoryInboundEventDeduplicator
  implements InboundEventDeduplicator
{
  private readonly events = new Map<string, number>();

  async claim(eventId: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.events.get(eventId);
    if (expiresAt !== undefined && expiresAt > now) {
      return false;
    }
    this.events.set(eventId, now + ttlSeconds * 1_000);
    return true;
  }
}
