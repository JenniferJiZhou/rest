import { describe, expect, it, vi } from "vitest";
import { ConnectorHost } from "../../src/inbox/connector-host.js";
import { InMemoryCheckpointStore } from "../../src/inbox/in-memory.js";
import type { InboxSource } from "../../src/inbox/ports.js";

describe("ConnectorHost", () => {
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
    await Promise.resolve();
    expect(pull).toHaveBeenCalledTimes(1);
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
