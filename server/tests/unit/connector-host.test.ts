import { describe, expect, it, vi } from "vitest";
import { InboxService } from "../../src/application/inbox/inbox-service.js";
import { ConnectorHost } from "../../src/inbox/connector-host.js";
import { InMemoryConfirmationTokenStore } from "../../src/inbox/confirmation.js";
import {
  InboxSendIdempotencyStore,
  InMemoryCheckpointStore,
  InMemoryInboxDraftRepository,
  InMemoryInboxRepository
} from "../../src/inbox/in-memory.js";
import {
  StepFunInboxIntelligenceProvider,
  type StepFunTransport
} from "../../src/inbox/intelligence.js";
import type { InboxSource } from "../../src/inbox/ports.js";
import { InMemoryInboxStateBackend } from "../../src/inbox/state-backend.js";

describe("ConnectorHost", () => {
  it.each([
    { configured: 25, expected: 25 },
    { configured: 250, expected: 100 }
  ])(
    "passes a configured batch limit capped at 100 ($configured -> $expected)",
    async ({ configured, expected }) => {
      const pull = vi.fn(async () => ({
        checkpoint: "checkpoint-1",
        items: [],
        participantBindings: []
      }));
      const host = new ConnectorHost(
        [
          {
            source: {
              provider: "outlook",
              dataOrigin: "mock",
              health: async () => "ready",
              pull
            },
            accountId: "outlook-account"
          }
        ],
        { ingest: vi.fn().mockResolvedValue({}) },
        new InMemoryCheckpointStore(),
        { next: () => "connector-request-limit" },
        30_000,
        Date.now,
        30_000,
        configured
      );

      await host.runOnce();

      expect(pull).toHaveBeenCalledWith(
        expect.objectContaining({ limit: expected }),
        expect.any(Object)
      );
    }
  );

  it("passes private participant bindings only through the local ingest call", async () => {
    const participantBindings = [
      {
        provider: "outlook" as const,
        accountId: "outlook-account",
        conversationId: "conversation-1",
        participantRef: "participant_12345678",
        providerParticipantId: "ou_private_value",
        displayName: "王同学"
      }
    ];
    const sourceWithBindings = source("outlook");
    sourceWithBindings.pull = async (input) => {
      const pulled = await source("outlook").pull(input);
      return { ...pulled, participantBindings };
    };
    const ingest = vi.fn().mockResolvedValue({
      accepted: 1,
      duplicates: 0,
      itemIds: ["i1"]
    });
    const host = new ConnectorHost(
      [{ source: sourceWithBindings, accountId: "outlook-account" }],
      { ingest },
      new InMemoryCheckpointStore(),
      { next: () => "connector-request-bindings" },
      30_000
    );

    await host.runOnce();

    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        events: expect.any(Array)
      }),
      participantBindings
    );
  });

  it("syncs providers independently and checkpoints only successful ingest", async () => {
    const checkpoints = new InMemoryCheckpointStore(
      () => new Date("2026-07-24T01:00:00.000Z")
    );
    const ingest = vi
      .fn()
      .mockResolvedValue({ accepted: 1, duplicates: 0, itemIds: ["i1"] });
    const host = new ConnectorHost(
      [
        { source: source("outlook"), accountId: "outlook-account" },
        {
          source: failingSource("qq_mail"),
          accountId: "qq-account"
        }
      ],
      { ingest },
      checkpoints,
      { next: () => "connector-request-1" },
      30_000
    );

    await host.runOnce();

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(await checkpoints.get("outlook", "outlook-account")).toBe(
      "outlook-checkpoint-1"
    );
    expect(await checkpoints.statuses()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "qq_mail",
          account_id: "qq-account",
          status: "degraded"
        })
      ])
    );
  });

  it("retains the old checkpoint and records only a sanitized failure when ingest rejects", async () => {
    const checkpoints = new InMemoryCheckpointStore(
      () => new Date("2026-07-24T01:00:00.000Z")
    );
    await checkpoints.put(
      "outlook",
      "outlook-account",
      "old-checkpoint"
    );
    const ingest = vi
      .fn()
      .mockRejectedValue(
        new Error("private message body and provider credential")
      );
    const host = new ConnectorHost(
      [{ source: source("outlook"), accountId: "outlook-account" }],
      { ingest },
      checkpoints,
      { next: () => "connector-request-ingest-failure" },
      30_000
    );

    await host.runOnce();

    expect(await checkpoints.get("outlook", "outlook-account")).toBe(
      "old-checkpoint"
    );
    expect(await checkpoints.statuses()).toEqual([
      expect.objectContaining({
        provider: "outlook",
        account_id: "outlook-account",
        status: "degraded",
        checkpoint: "old-checkpoint",
        last_error: "provider_sync_failed"
      })
    ]);
    expect(JSON.stringify(await checkpoints.statuses())).not.toMatch(
      /private message|credential/u
    );
  });

  it("rejects double start and can be stopped", () => {
    const host = new ConnectorHost(
      [],
      { ingest: vi.fn() },
      new InMemoryCheckpointStore(),
      { next: () => "connector-request-1" },
      30_000
    );

    host.start();
    expect(() => host.start()).toThrow(/already started/i);
    host.stop();
    expect(() => host.start()).not.toThrow();
    host.stop();
  });

  it("runs Inbox crash recovery before the first production poll", async () => {
    const order: string[] = [];
    const recover = vi.fn(async () => {
      order.push("recover");
    });
    const pull = vi.fn(async () => {
      order.push("pull");
      return {
        checkpoint: "checkpoint-after-recovery",
        items: [],
        participantBindings: []
      };
    });
    const host = new ConnectorHost(
      [
        {
          source: {
            provider: "outlook",
            dataOrigin: "mock",
            health: async () => "ready",
            pull
          },
          accountId: "outlook-account"
        }
      ],
      {
        recover,
        ingest: vi.fn().mockResolvedValue({
          accepted: 0,
          duplicates: 0,
          itemIds: []
        })
      },
      new InMemoryCheckpointStore(),
      { next: () => "connector-request-recovery" },
      30_000
    );

    host.start();
    await vi.waitFor(() => {
      expect(pull).toHaveBeenCalledTimes(1);
    });
    await host.stop();

    expect(recover).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["recover", "pull"]);
  });

  it("coalesces overlapping cycles", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pull = vi.fn(async () => {
      await gate;
      return {
        checkpoint: "checkpoint-1",
        items: [],
        participantBindings: []
      };
    });
    const host = new ConnectorHost(
      [
        {
          source: {
            provider: "outlook",
            dataOrigin: "mock",
            health: async () => "ready",
            pull
          },
          accountId: "outlook-account"
        }
      ],
      { ingest: vi.fn().mockResolvedValue({}) },
      new InMemoryCheckpointStore(),
      { next: () => "connector-request-1" },
      30_000
    );

    const first = host.runOnce();
    const second = host.runOnce();
    await vi.waitFor(() => {
      expect(pull).toHaveBeenCalledTimes(1);
    });
    release();
    await Promise.all([first, second]);
  });

  it("backs off a failing account without blocking healthy accounts", async () => {
    let now = 0;
    const failedPull = vi.fn(async () => {
      throw new Error("provider unavailable");
    });
    const healthyPull = vi.fn(async () => ({
      checkpoint: `healthy-${healthyPull.mock.calls.length}`,
      items: [],
      participantBindings: []
    }));
    const host = new ConnectorHost(
      [
        {
          source: {
            provider: "qq_mail",
            dataOrigin: "mock",
            health: async () => "ready",
            pull: failedPull
          },
          accountId: "qq-account"
        },
        {
          source: {
            provider: "outlook",
            dataOrigin: "mock",
            health: async () => "ready",
            pull: healthyPull
          },
          accountId: "outlook-account"
        }
      ],
      { ingest: vi.fn().mockResolvedValue({}) },
      new InMemoryCheckpointStore(),
      { next: () => "connector-request-1" },
      1_000,
      () => now
    );

    await host.runOnce();
    await host.runOnce();
    expect(failedPull).toHaveBeenCalledTimes(1);
    expect(healthyPull).toHaveBeenCalledTimes(2);

    now = 2_000;
    await host.runOnce();
    expect(failedPull).toHaveBeenCalledTimes(2);
    expect(healthyPull).toHaveBeenCalledTimes(3);
  });

  it("bounds a stalled account pull", async () => {
    const healthyPull = vi.fn(async () => ({
      checkpoint: "healthy-checkpoint",
      items: [],
      participantBindings: []
    }));
    const host = new ConnectorHost(
      [
        {
          source: {
            provider: "qq_mail",
            dataOrigin: "mock",
            health: async () => "ready",
            pull: async () => new Promise(() => undefined)
          },
          accountId: "qq-account"
        },
        {
          source: {
            provider: "outlook",
            dataOrigin: "mock",
            health: async () => "ready",
            pull: healthyPull
          },
          accountId: "outlook-account"
        }
      ],
      { ingest: vi.fn().mockResolvedValue({}) },
      new InMemoryCheckpointStore(),
      { next: () => "connector-request-1" },
      1_000,
      Date.now,
      10
    );

    await expect(host.runOnce()).resolves.toBeUndefined();
    expect(healthyPull).toHaveBeenCalledTimes(1);
  });

  it("continues connector polling after a hanging StepFun enrichment times out", async () => {
    const backend = new InMemoryInboxStateBackend();
    const checkpoints = new InMemoryCheckpointStore(
      () => new Date("2026-07-24T01:00:00.000Z"),
      backend
    );
    const transport = new ConnectorAbortOnlyTransport();
    const intelligence = new StepFunInboxIntelligenceProvider(
      {
        baseUrl: "https://stepfun.example/v1",
        apiKey: "safe-test-key",
        model: "step-3.7-flash",
        maxMessagesPerChunk: 100,
        maxPromptCharacters: 60_000,
        timeoutMs: 10
      },
      transport
    );
    let id = 0;
    const service = new InboxService(
      new InMemoryInboxRepository(backend),
      new InMemoryInboxDraftRepository(backend),
      intelligence,
      new Map(),
      new InMemoryConfirmationTokenStore(),
      new InboxSendIdempotencyStore(backend),
      checkpoints,
      { now: () => new Date("2026-07-24T01:00:00.000Z") },
      { next: (prefix) => `${prefix}-${++id}` }
    );
    const pull = vi.fn(async ({ accountId }) => ({
      checkpoint: `checkpoint-${pull.mock.calls.length}`,
      participantBindings: [],
      items: [
        {
          provider: "outlook" as const,
          account_id: accountId,
          conversation_id: "conversation-timeout",
          conversation_type: "direct" as const,
          conversation_name: "项目会话",
          provider_message_id: `message-${pull.mock.calls.length}`,
          sender: "王同学",
          sender_ref: null,
          recipients: [accountId],
          subject: null,
          content: "请确认接口交付时间。",
          received_at: `2026-07-24T01:0${pull.mock.calls.length}:00.000Z`,
          coverage: {
            source: "official_api" as const,
            complete: true,
            note: null
          }
        }
      ]
    }));
    const host = new ConnectorHost(
      [
        {
          source: {
            provider: "outlook",
            dataOrigin: "real",
            health: async () => "ready",
            pull
          },
          accountId: "outlook-account"
        }
      ],
      service,
      checkpoints,
      { next: (prefix) => `${prefix}-${++id}` },
      1_000
    );
    const startedAt = Date.now();

    await host.runOnce();
    await host.runOnce();

    expect(Date.now() - startedAt).toBeLessThan(200);
    expect(transport.abortCount).toBe(2);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(
      (await service.listItems({ limit: 20 })).items.map(
        (item) => item.sync_status
      )
    ).toEqual(["failed", "failed"]);
    await expect(
      checkpoints.get("outlook", "outlook-account")
    ).resolves.toBe("checkpoint-2");
  });
});

function source(provider: "outlook"): InboxSource {
  return {
    provider,
    dataOrigin: "mock",
    health: async () => "ready",
    pull: async ({ accountId }) => ({
      checkpoint: "outlook-checkpoint-1",
      participantBindings: [],
      items: [
        {
          provider,
          account_id: accountId,
          conversation_id: "conversation-1",
          conversation_type: "direct",
          conversation_name: "项目会话",
          provider_message_id: "message-1",
          sender: "sender@example.com",
          sender_ref: null,
          recipients: ["hush@example.com"],
          subject: "项目确认",
          content: "请确认时间。",
          received_at: "2026-07-24T01:00:00.000Z",
          coverage: {
            source: "official_api",
            complete: true,
            note: null
          }
        }
      ]
    })
  };
}

function failingSource(provider: "qq_mail"): InboxSource {
  return {
    provider,
    dataOrigin: "mock",
    health: async () => "degraded",
    pull: async () => {
      throw new Error("provider failure with private body");
    }
  };
}

class ConnectorAbortOnlyTransport implements StepFunTransport {
  abortCount = 0;

  completeJson(input: { signal?: AbortSignal }): Promise<unknown> {
    return new Promise((_, reject) => {
      const safetyTimer = setTimeout(() => {
        reject(new Error("private connector transport deadline"));
      }, 250);
      input.signal?.addEventListener(
        "abort",
        () => {
          this.abortCount += 1;
          clearTimeout(safetyTimer);
          reject(new Error("transport aborted"));
        },
        { once: true }
      );
    });
  }
}
