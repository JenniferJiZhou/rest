import { afterEach, describe, expect, it, vi } from "vitest";
import { CannedAgentLLM } from "../../src/agent/canned-llm.js";
import { HandoffService } from "../../src/application/handoff/handoff-service.js";
import type { HandoffJobState } from "../../src/domain/contracts.js";
import type { HandoffJobRecord } from "../../src/domain/ports.js";
import {
  InMemoryHandoffJobRepository,
  InMemoryIdempotencyStore
} from "../../src/infra/in-memory.js";
import {
  NoopHandoffCompletionSink,
  UnavailableMailProvider
} from "../../src/infra/provider-stubs.js";

describe("in-memory expiration cleanup", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("deletes only expired terminal Jobs", async () => {
    const jobs = new InMemoryHandoffJobRepository();
    await jobs.create(jobRecord("old_terminal", "cancelled", "2026-07-20"));
    await jobs.create(jobRecord("old_running", "running", "2026-07-20"));
    await jobs.create(jobRecord("recent_terminal", "failed", "2026-07-24"));

    await expect(
      jobs.deleteExpired("2026-07-23T00:00:00.000Z")
    ).resolves.toBe(1);
    await expect(jobs.get("hj_old_terminal")).resolves.toBeNull();
    await expect(jobs.get("hj_old_running")).resolves.not.toBeNull();
    await expect(jobs.get("hj_recent_terminal")).resolves.not.toBeNull();
  });

  it("removes expired idempotency claims without touching live claims", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T00:00:00.000Z"));
    const store = new InMemoryIdempotencyStore<string>();
    await store.claimOrGet({
      key: "expired",
      requestHash: "hash-expired",
      ttlSeconds: 60,
      create: async () => "old"
    });
    await store.claimOrGet({
      key: "live",
      requestHash: "hash-live",
      ttlSeconds: 3600,
      create: async () => "live"
    });
    vi.advanceTimersByTime(61_000);

    await expect(
      store.deleteExpired(new Date().toISOString())
    ).resolves.toBe(1);
    let recreated = 0;
    await expect(
      store.claimOrGet({
        key: "expired",
        requestHash: "hash-new",
        ttlSeconds: 60,
        create: async () => {
          recreated += 1;
          return "new";
        }
      })
    ).resolves.toMatchObject({ kind: "created", value: "new" });
    expect(recreated).toBe(1);
    await expect(
      store.claimOrGet({
        key: "live",
        requestHash: "hash-live",
        ttlSeconds: 3600,
        create: async () => "unexpected"
      })
    ).resolves.toMatchObject({
      kind: "existing_same_request",
      value: "live"
    });
  });

  it("runs throttled opportunistic cleanup when a Handoff starts", async () => {
    const jobs = new InMemoryHandoffJobRepository();
    await jobs.create(jobRecord("expired", "cancelled", "2026-07-20"));
    const service = new HandoffService(
      jobs,
      new InMemoryIdempotencyStore<string>(),
      new UnavailableMailProvider(),
      new CannedAgentLLM(),
      new NoopHandoffCompletionSink(),
      { now: () => new Date("2026-07-24T12:00:00.000Z") },
      { next: (prefix) => `${prefix}_new` },
      { log: () => {} }
    );

    await service.start(
      {
        schema_version: "1.0",
        request_id: "req_cleanup_start",
        source: "ios_app",
        include_gmail: false,
        gmail_account_id: null,
        open_loops: [],
        response_channel: "app",
        timezone: "Asia/Shanghai",
        locale: "zh-CN"
      },
      "cleanup-start-key"
    );

    await expect(jobs.get("hj_expired")).resolves.toBeNull();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});

function jobRecord(
  suffix: string,
  status: "running" | "failed" | "cancelled",
  day: string
): HandoffJobRecord {
  const progressStage: HandoffJobState["progress_stage"] =
    status === "running" ? "classifying" : status;
  return {
    job: {
      schema_version: "1.0",
      request_id: `req_${suffix}`,
      job_id: `hj_${suffix}`,
      status: "queued",
      estimated_wait_seconds: 5,
      micro_reset_available: true
    },
    request: {
      schema_version: "1.0",
      request_id: `req_${suffix}`,
      source: "ios_app",
      include_gmail: false,
      gmail_account_id: null,
      open_loops: [],
      response_channel: "app",
      timezone: "Asia/Shanghai",
      locale: "zh-CN"
    },
    state: {
      schema_version: "1.0",
      request_id: `req_${suffix}`,
      job_id: `hj_${suffix}`,
      status,
      progress_stage: progressStage,
      estimated_wait_seconds: status === "running" ? 5 : null,
      summary: null,
      error: null
    },
    idempotencyKey: `idem_${suffix}`,
    createdAt: `${day}T00:00:00.000Z`,
    updatedAt: `${day}T00:00:00.000Z`,
    cancelled: status === "cancelled"
  };
}
