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
    expect(second.created).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect((await repository.list({ limit: 20 })).items).toHaveLength(1);
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

function draftInput() {
  return {
    id: "draft-1",
    inboxItemId: "item-1",
    content: "AI 草稿",
    contentType: "text" as const,
    now: "2026-07-24T01:01:00.000Z"
  };
}
