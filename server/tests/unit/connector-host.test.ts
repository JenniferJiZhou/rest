import { describe, expect, it, vi } from "vitest";
import { ConnectorHost } from "../../src/inbox/connector-host.js";
import { InMemoryCheckpointStore } from "../../src/inbox/in-memory.js";
import type { InboxSource } from "../../src/inbox/ports.js";

describe("ConnectorHost", () => {
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
});

function source(provider: "outlook"): InboxSource {
  return {
    provider,
    dataOrigin: "mock",
    health: async () => "ready",
    pull: async ({ accountId }) => ({
      checkpoint: "outlook-checkpoint-1",
      items: [
        {
          provider,
          account_id: accountId,
          conversation_id: "conversation-1",
          provider_message_id: "message-1",
          sender: "sender@example.com",
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
