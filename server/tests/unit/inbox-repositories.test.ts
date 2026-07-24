import { describe, expect, it } from "vitest";
import type { InboxEvent } from "../../src/domain/contracts.js";
import {
  InMemoryCheckpointStore,
  InMemoryInboxDraftRepository,
  InMemoryInboxRepository
} from "../../src/inbox/in-memory.js";

describe("Unified Inbox in-memory repositories", () => {
  it("deduplicates the same provider account and message", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(event("message-1"));
    const second = await repository.upsert(event("message-1"));

    expect(first.created).toBe(true);
    expect(first.changed).toBe(true);
    expect(second.created).toBe(false);
    expect(second.changed).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect((await repository.list({ limit: 20 })).items).toHaveLength(1);
  });

  it("aggregates unacknowledged group messages by provider account and conversation", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(
      groupEvent({
        messageId: "group-message-1",
        receivedAt: "2026-07-24T00:00:00.000Z"
      }),
      "2026-07-24T00:00:01.000Z"
    );
    const second = await repository.upsert(
      groupEvent({
        messageId: "group-message-2",
        receivedAt: "2026-07-24T00:01:00.000Z"
      }),
      "2026-07-24T00:01:01.000Z"
    );

    expect(second).toMatchObject({
      created: false,
      changed: true,
      item: {
        id: first.item.id,
        item_kind: "conversation_digest",
        revision: 2,
        message_count: 2,
        window_started_at: "2026-07-24T00:00:00.000Z",
        window_ended_at: "2026-07-24T00:01:00.000Z",
        sender: null,
        sender_ref: null,
        content: null
      }
    });
    await expect(repository.sourceMessages(first.item.id)).resolves.toEqual([
      {
        providerMessageId: "group-message-1",
        senderRef: "participant_demo_0002",
        senderDisplayName: "王同学",
        content: "请确认接口交付时间。",
        receivedAt: "2026-07-24T00:00:00.000Z"
      },
      {
        providerMessageId: "group-message-2",
        senderRef: "participant_demo_0002",
        senderDisplayName: "王同学",
        content: "请确认接口交付时间。",
        receivedAt: "2026-07-24T00:01:00.000Z"
      }
    ]);
  });

  it("does not append a duplicate group provider message", async () => {
    const repository = new InMemoryInboxRepository();
    const source = groupEvent({
      messageId: "group-message-duplicate",
      receivedAt: "2026-07-24T00:00:00.000Z"
    });
    const first = await repository.upsert(source);
    const duplicate = await repository.upsert(source);

    expect(duplicate).toMatchObject({
      created: false,
      changed: false,
      item: {
        id: first.item.id,
        revision: 1,
        message_count: 1
      }
    });
    await expect(repository.sourceMessages(first.item.id)).resolves.toHaveLength(
      1
    );
  });

  it("acknowledges only the exact revision and starts a new digest", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(
      groupEvent({
        messageId: "group-message-acknowledged",
        receivedAt: "2026-07-24T00:00:00.000Z"
      })
    );
    const acknowledged = await repository.acknowledge(
      first.item.id,
      first.item.revision,
      "2026-07-24T00:10:00.000Z"
    );
    const next = await repository.upsert(
      groupEvent({
        messageId: "group-message-after-acknowledge",
        receivedAt: "2026-07-24T00:11:00.000Z"
      })
    );

    expect(acknowledged).toMatchObject({
      acknowledged_at: "2026-07-24T00:10:00.000Z",
      sealed_at: "2026-07-24T00:10:00.000Z"
    });
    expect(next.created).toBe(true);
    expect(next.item.id).not.toBe(first.item.id);
  });

  it("rejects a stale digest acknowledgement with only the current revision", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(
      groupEvent({
        messageId: "group-message-stale-1",
        receivedAt: "2026-07-24T00:00:00.000Z"
      })
    );
    await repository.upsert(
      groupEvent({
        messageId: "group-message-stale-2",
        receivedAt: "2026-07-24T00:01:00.000Z"
      })
    );

    await expect(
      repository.acknowledge(
        first.item.id,
        first.item.revision,
        "2026-07-24T00:10:00.000Z"
      )
    ).rejects.toMatchObject({
      code: "INBOX_VERSION_CONFLICT",
      details: { current_revision: 2 }
    });
  });

  it("rolls over a group digest after 1000 source messages", async () => {
    const repository = new InMemoryInboxRepository();
    let firstItemId = "";

    for (let index = 1; index <= 1_000; index += 1) {
      const result = await repository.upsert(
        groupEvent({
          messageId: `group-message-${index}`,
          receivedAt: new Date(
            Date.parse("2026-07-24T00:00:00.000Z") + index * 1_000
          ).toISOString()
        }),
        "2026-07-24T01:00:00.000Z"
      );
      firstItemId ||= result.item.id;
    }

    const overflow = await repository.upsert(
      groupEvent({
        messageId: "group-message-1001",
        receivedAt: "2026-07-24T01:00:01.000Z"
      }),
      "2026-07-24T01:00:01.000Z"
    );

    expect(overflow.created).toBe(true);
    expect(overflow.item.id).not.toBe(firstItemId);
    expect(overflow.item.message_count).toBe(1);
    expect(await repository.get(firstItemId)).toMatchObject({
      message_count: 1_000,
      sealed_at: "2026-07-24T01:00:01.000Z"
    });
  });

  it("rolls over a group digest at the 24 hour boundary", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(
      groupEvent({
        messageId: "group-message-day-1",
        receivedAt: "2026-07-24T00:00:00.000Z"
      })
    );
    const next = await repository.upsert(
      groupEvent({
        messageId: "group-message-day-2",
        receivedAt: "2026-07-25T00:00:00.000Z"
      }),
      "2026-07-25T00:00:01.000Z"
    );

    expect(next.created).toBe(true);
    expect(next.item.id).not.toBe(first.item.id);
    expect(await repository.get(first.item.id)).toMatchObject({
      sealed_at: "2026-07-25T00:00:01.000Z"
    });
  });

  it("keeps direct messages in the same conversation independent", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(event("direct-message-1"));
    const second = await repository.upsert(event("direct-message-2"));

    expect(second.created).toBe(true);
    expect(second.item.id).not.toBe(first.item.id);
    expect(first.item).toMatchObject({
      item_kind: "message",
      revision: 1,
      message_count: 1
    });
    expect(second.item).toMatchObject({
      item_kind: "message",
      revision: 1,
      message_count: 1
    });
  });

  it("does not save enrichment for a stale digest revision", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(
      groupEvent({
        messageId: "group-message-enrichment-1",
        receivedAt: "2026-07-24T00:00:00.000Z"
      })
    );
    await repository.upsert(
      groupEvent({
        messageId: "group-message-enrichment-2",
        receivedAt: "2026-07-24T00:01:00.000Z"
      })
    );

    await expect(
      repository.saveEnrichment(
        first.item.id,
        first.item.revision,
        enrichment()
      )
    ).rejects.toMatchObject({
      code: "INBOX_VERSION_CONFLICT",
      details: { current_revision: 2 }
    });
    expect(await repository.get(first.item.id)).toMatchObject({
      summary: null,
      sync_status: "pending"
    });
  });

  it("clears digest enrichment and draft linkage when a message is appended", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(
      groupEvent({
        messageId: "group-message-clear-1",
        receivedAt: "2026-07-24T00:00:00.000Z"
      })
    );
    await repository.saveEnrichment(
      first.item.id,
      first.item.revision,
      enrichment()
    );
    await repository.setDraftId(first.item.id, "draft-group-1");

    const appended = await repository.upsert(
      groupEvent({
        messageId: "group-message-clear-2",
        receivedAt: "2026-07-24T00:01:00.000Z"
      })
    );

    expect(appended.item).toMatchObject({
      summary: null,
      important_points: [],
      todos: [],
      priority: "uncertain",
      needs_reply: null,
      reply_targets: [],
      draft_id: null,
      sync_status: "pending"
    });
  });

  it("does not expose mutable repository state", async () => {
    const repository = new InMemoryInboxRepository();
    const created = await repository.upsert(event("message-2"));
    created.item.recipients.push("mutated@example.com");

    expect((await repository.get(created.item.id))?.recipients).toEqual([
      "hush@example.com"
    ]);
  });

  it("redacts a group source event when creating and listing its public item", async () => {
    const repository = new InMemoryInboxRepository();
    const groupEvent: InboxEvent = {
      ...event("group-message-1"),
      conversation_id: "group-conversation-1",
      conversation_type: "group",
      conversation_name: "产品讨论组",
      sender: "王同学",
      sender_ref: "participant_demo_0002",
      content: "请确认接口交付时间。"
    };

    const created = await repository.upsert(groupEvent);
    const listed = await repository.list({ limit: 20 });

    expect(created.item).toMatchObject({
      item_kind: "conversation_digest",
      sender: null,
      sender_ref: null,
      content: null
    });
    expect(listed.items[0]).toMatchObject({
      item_kind: "conversation_digest",
      sender: null,
      sender_ref: null,
      content: null
    });
  });

  it("rejects a stale draft version", async () => {
    const repository = new InMemoryInboxDraftRepository();
    const draft = await repository.create(draftInput());
    await repository.update(draft.id, {
      content: "用户第一次修改",
      contentType: "text",
      expectedVersion: draft.version
    });

    await expect(
      repository.update(draft.id, {
        content: "过期页面修改",
        contentType: "text",
        expectedVersion: draft.version
      })
    ).rejects.toMatchObject({ code: "INBOX_VERSION_CONFLICT" });
  });

  it("records independent sync status per provider account", async () => {
    const checkpoints = new InMemoryCheckpointStore(
      () => new Date("2026-07-24T08:00:00.000Z")
    );

    await checkpoints.put("outlook", "outlook@example.com", "delta-2");
    await checkpoints.recordFailure(
      "qq_mail",
      "qq@example.com",
      "provider unavailable"
    );

    expect(await checkpoints.statuses()).toEqual([
      expect.objectContaining({
        provider: "outlook",
        account_id: "outlook@example.com",
        status: "ready",
        checkpoint: "delta-2"
      }),
      expect.objectContaining({
        provider: "qq_mail",
        account_id: "qq@example.com",
        status: "degraded",
        last_error: "provider unavailable"
      })
    ]);
  });
});

function event(providerMessageId: string): InboxEvent {
  return {
    provider: "outlook",
    account_id: "hush@example.com",
    conversation_id: "conversation-1",
    conversation_type: "direct",
    conversation_name: "项目会话",
    provider_message_id: providerMessageId,
    sender: "sender@example.com",
    sender_ref: null,
    recipients: ["hush@example.com"],
    subject: "项目确认",
    content: "请确认项目时间。",
    received_at: "2026-07-24T09:00:00+08:00",
    coverage: {
      source: "official_api",
      complete: true,
      note: null
    }
  };
}

function groupEvent(input: {
  messageId: string;
  receivedAt: string;
}): InboxEvent {
  return {
    ...event(input.messageId),
    conversation_id: "group-conversation-1",
    conversation_type: "group",
    conversation_name: "产品讨论组",
    sender: "王同学",
    sender_ref: "participant_demo_0002",
    content: "请确认接口交付时间。",
    received_at: input.receivedAt
  };
}

function enrichment() {
  return {
    summary: "群聊摘要",
    important_points: ["待确认交付时间"],
    todos: ["确认交付时间"],
    priority: "urgent" as const,
    needs_reply: true,
    reply_targets: [
      {
        target_id: "participant_demo_0002",
        display_name: "王同学",
        reason: "需要确认"
      }
    ]
  };
}

function draftInput() {
  return {
    id: "draft-1",
    inboxItemId: "item-1",
    content: "AI 草稿",
    contentType: "text" as const,
    now: "2026-07-24T01:01:00.000Z"
  };
}
