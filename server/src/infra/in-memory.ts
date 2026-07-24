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
  IdempotencyStore
} from "../domain/ports.js";

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
