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

  it("creates independently sealed digests for group events without a conversation ID", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(
      groupEvent({
        messageId: "group-null-conversation-1",
        receivedAt: "2026-07-24T00:00:00.000Z",
        conversationId: null
      }),
      "2026-07-24T00:00:01.000Z"
    );
    const second = await repository.upsert(
      groupEvent({
        messageId: "group-null-conversation-2",
        receivedAt: "2026-07-24T00:01:00.000Z",
        conversationId: null
      }),
      "2026-07-24T00:01:01.000Z"
    );

    expect(first).toMatchObject({
      created: true,
      changed: true,
      item: {
        conversation_id: null,
        message_count: 1,
        sealed_at: "2026-07-24T00:00:01.000Z",
        sender: null,
        sender_ref: null,
        content: null
      }
    });
    expect(second).toMatchObject({
      created: true,
      changed: true,
      item: {
        conversation_id: null,
        message_count: 1,
        sealed_at: "2026-07-24T00:01:01.000Z",
        sender: null,
        sender_ref: null,
        content: null
      }
    });
    expect(second.item.id).not.toBe(first.item.id);
  });

  it("keeps an out-of-order group window chronological", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(
      groupEvent({
        messageId: "group-message-10",
        receivedAt: "2026-07-24T10:00:00.000Z"
      })
    );
    const earlier = await repository.upsert(
      groupEvent({
        messageId: "group-message-09",
        receivedAt: "2026-07-24T09:00:00.000Z"
      })
    );

    expect(earlier.item).toMatchObject({
      id: first.item.id,
      window_started_at: "2026-07-24T09:00:00.000Z",
      window_ended_at: "2026-07-24T10:00:00.000Z",
      received_at: "2026-07-24T10:00:00.000Z"
    });
    await expect(repository.sourceMessages(first.item.id)).resolves.toEqual([
      expect.objectContaining({
        providerMessageId: "group-message-09",
        receivedAt: "2026-07-24T09:00:00.000Z"
      }),
      expect.objectContaining({
        providerMessageId: "group-message-10",
        receivedAt: "2026-07-24T10:00:00.000Z"
      })
    ]);
  });

  it("sorts equal-time source messages by provider message ID", async () => {
    const repository = new InMemoryInboxRepository();
    await repository.upsert(
      groupEvent({
        messageId: "group-message-b",
        receivedAt: "2026-07-24T10:00:00.000Z"
      })
    );
    const appended = await repository.upsert(
      groupEvent({
        messageId: "group-message-a",
        receivedAt: "2026-07-24T10:00:00.000Z"
      })
    );

    expect(
      (await repository.sourceMessages(appended.item.id)).map(
        (message) => message.providerMessageId
      )
    ).toEqual(["group-message-a", "group-message-b"]);
  });

  it("keeps the current open window when an older message exceeds 24 hours", async () => {
    const repository = new InMemoryInboxRepository();
    const current = await repository.upsert(
      groupEvent({
        messageId: "group-message-current",
        receivedAt: "2026-07-25T10:00:00.000Z"
      })
    );
    const late = await repository.upsert(
      groupEvent({
        messageId: "group-message-late",
        receivedAt: "2026-07-24T09:00:00.000Z"
      }),
      "2026-07-25T10:01:00.000Z"
    );
    const followUp = await repository.upsert(
      groupEvent({
        messageId: "group-message-follow-up",
        receivedAt: "2026-07-25T11:00:00.000Z"
      })
    );

    expect(late).toMatchObject({
      created: true,
      item: {
        message_count: 1,
        sealed_at: "2026-07-25T10:01:00.000Z"
      }
    });
    expect(late.item.id).not.toBe(current.item.id);
    expect(followUp).toMatchObject({
      created: false,
      item: {
        id: current.item.id,
        message_count: 2,
        window_started_at: "2026-07-25T10:00:00.000Z",
        window_ended_at: "2026-07-25T11:00:00.000Z"
      }
    });
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
    const duplicate = await repository.upsert(
      groupEvent({
        messageId: "group-message-acknowledged",
        receivedAt: "2026-07-24T00:00:00.000Z"
      })
    );
    expect(duplicate).toMatchObject({
      created: false,
      changed: false,
      item: { id: first.item.id }
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

    const error = await repository
      .acknowledge(
        first.item.id,
        first.item.revision,
        "2026-07-24T00:10:00.000Z"
      )
      .then(
        () => null,
        (caught: unknown) => caught
      );
    expect(error).toMatchObject({ code: "INBOX_VERSION_CONFLICT" });
    expect((error as { details: unknown }).details).toEqual({
      current_revision: 2
    });
  });

  it("seals a group digest as soon as it accepts source message 1000", async () => {
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

    expect(await repository.get(firstItemId)).toMatchObject({
      message_count: 1_000,
      sealed_at: "2026-07-24T01:00:00.000Z"
    });
    const duplicate = await repository.upsert(
      groupEvent({
        messageId: "group-message-1000",
        receivedAt: new Date(
          Date.parse("2026-07-24T00:00:00.000Z") + 1_000 * 1_000
        ).toISOString()
      })
    );
    expect(duplicate).toMatchObject({
      created: false,
      changed: false,
      item: {
        id: firstItemId,
        message_count: 1_000,
        sealed_at: "2026-07-24T01:00:00.000Z"
      }
    });

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
  });

  it("keeps a group digest open just before 24 hours and rolls over at the boundary", async () => {
    const repository = new InMemoryInboxRepository();
    const first = await repository.upsert(
      groupEvent({
        messageId: "group-message-day-1",
        receivedAt: "2026-07-24T00:00:00.000Z"
      })
    );
    const justBefore = await repository.upsert(
      groupEvent({
        messageId: "group-message-just-before-day-2",
        receivedAt: "2026-07-24T23:59:59.999Z"
      }),
      "2026-07-24T23:59:59.999Z"
    );
    expect(justBefore).toMatchObject({
      created: false,
      item: {
        id: first.item.id,
        message_count: 2,
        sealed_at: null
      }
    });

    const boundary = await repository.upsert(
      groupEvent({
        messageId: "group-message-day-2",
        receivedAt: "2026-07-25T00:00:00.000Z"
      }),
      "2026-07-25T00:00:01.000Z"
    );

    expect(boundary.created).toBe(true);
    expect(boundary.item.id).not.toBe(first.item.id);
    expect(boundary.item.sealed_at).toBeNull();
    expect(await repository.get(first.item.id)).toMatchObject({
      sealed_at: "2026-07-25T00:00:01.000Z"
    });
    const duplicate = await repository.upsert(
      groupEvent({
        messageId: "group-message-just-before-day-2",
        receivedAt: "2026-07-24T23:59:59.999Z"
      })
    );
    expect(duplicate).toMatchObject({
      created: false,
      changed: false,
      item: { id: first.item.id }
    });
  });

  it("isolates open digests by provider, account, and conversation", async () => {
    const repository = new InMemoryInboxRepository();
    const results = await Promise.all([
      repository.upsert(
        groupEvent({
          messageId: "isolation-outlook-a-shared",
          receivedAt: "2026-07-24T00:00:00.000Z",
          provider: "outlook",
          accountId: "account-a",
          conversationId: "shared"
        })
      ),
      repository.upsert(
        groupEvent({
          messageId: "isolation-outlook-b-shared",
          receivedAt: "2026-07-24T00:00:00.000Z",
          provider: "outlook",
          accountId: "account-b",
          conversationId: "shared"
        })
      ),
      repository.upsert(
        groupEvent({
          messageId: "isolation-feishu-a-shared",
          receivedAt: "2026-07-24T00:00:00.000Z",
          provider: "feishu",
          accountId: "account-a",
          conversationId: "shared"
        })
      ),
      repository.upsert(
        groupEvent({
          messageId: "isolation-outlook-a-other",
          receivedAt: "2026-07-24T00:00:00.000Z",
          provider: "outlook",
          accountId: "account-a",
          conversationId: "other"
        })
      )
    ]);

    expect(new Set(results.map((result) => result.item.id)).size).toBe(4);
    expect(results.every((result) => result.created)).toBe(true);
  });

  it("uses collision-safe composite repository keys", async () => {
    const repository = new InMemoryInboxRepository();
    const firstDigest = await repository.upsert(
      groupEvent({
        messageId: "collision-group-1",
        receivedAt: "2026-07-24T00:00:00.000Z",
        accountId: "a\u0000b",
        conversationId: "c"
      })
    );
    const secondDigest = await repository.upsert(
      groupEvent({
        messageId: "collision-group-2",
        receivedAt: "2026-07-24T00:00:00.000Z",
        accountId: "a",
        conversationId: "b\u0000c"
      })
    );
    const firstMessage = await repository.upsert({
      ...event("c"),
      account_id: "a\u0000b"
    });
    const secondMessage = await repository.upsert({
      ...event("b\u0000c"),
      account_id: "a"
    });

    expect(secondDigest.created).toBe(true);
    expect(secondDigest.item.id).not.toBe(firstDigest.item.id);
    expect(secondMessage.created).toBe(true);
    expect(secondMessage.item.id).not.toBe(firstMessage.item.id);
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

    const error = await repository
      .saveEnrichment(
        first.item.id,
        first.item.revision,
        enrichment()
      )
      .then(
        () => null,
        (caught: unknown) => caught
      );
    expect(error).toMatchObject({ code: "INBOX_VERSION_CONFLICT" });
    expect((error as { details: unknown }).details).toEqual({
      current_revision: 2
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

  it("does not expose mutable private source-message state", async () => {
    const repository = new InMemoryInboxRepository();
    const created = await repository.upsert(
      groupEvent({
        messageId: "group-message-private-state",
        receivedAt: "2026-07-24T00:00:00.000Z"
      })
    );
    const messages = await repository.sourceMessages(created.item.id);
    messages[0]!.content = "mutated";
    messages.push({
      providerMessageId: "injected",
      senderRef: null,
      senderDisplayName: null,
      content: "injected",
      receivedAt: "2026-07-24T00:00:01.000Z"
    });

    await expect(repository.sourceMessages(created.item.id)).resolves.toEqual([
      expect.objectContaining({
        providerMessageId: "group-message-private-state",
        content: "请确认接口交付时间。"
      })
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
  provider?: InboxEvent["provider"];
  accountId?: string;
  conversationId?: string | null;
}): InboxEvent {
  return {
    ...event(input.messageId),
    provider: input.provider ?? "outlook",
    account_id: input.accountId ?? "hush@example.com",
    conversation_id:
      input.conversationId === undefined
        ? "group-conversation-1"
        : input.conversationId,
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
