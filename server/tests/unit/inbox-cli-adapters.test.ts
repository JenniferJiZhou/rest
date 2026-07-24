import { describe, expect, it } from "vitest";
import {
  DingTalkDwsAdapter,
  LarkCliAdapter
} from "../../src/inbox/providers/index.js";
import type {
  CommandInvocation,
  CommandRunner
} from "../../src/inbox/providers/command-runner.js";

describe("Inbox CLI adapters", () => {
  it("uses lark-cli JSON commands without a shell", async () => {
    const runner = new RecordingRunner([
      JSON.stringify({ authenticated: true }),
      JSON.stringify({
        items: [
          {
            message_id: "lark-message-1",
            chat_id: "lark-chat-1",
            sender: {
              id: "lark-user-1",
              name: "飞书用户"
            },
            content: "飞书消息",
            create_time: "1784854800000"
          }
        ],
        has_more: true,
        page_token: "lark-page-2"
      }),
      JSON.stringify({ message_id: "lark-sent-1" })
    ]);
    const adapter = new LarkCliAdapter(
      {
        executable: "/opt/lark-cli",
        accountId: "lark-account",
        now: () => new Date("2026-07-24T01:00:00.000Z")
      },
      runner
    );

    await expect(adapter.health()).resolves.toBe("ready");
    const pulled = await adapter.pull({
      accountId: "lark-account",
      checkpoint: null,
      limit: 20
    });
    const sent = await adapter.send(
      sendInput("lark-account", "lark-chat-1")
    );

    expect(pulled.items[0]).toMatchObject({
      provider: "feishu",
      provider_message_id: "lark-message-1",
      sender: "飞书用户",
      content: "飞书消息",
      received_at: "2026-07-24T01:00:00.000Z"
    });
    expect(sent.status).toBe("sent");
    expect(runner.invocations[0]?.args).toEqual([
      "auth",
      "status",
      "--format",
      "json"
    ]);
    expect(runner.invocations[1]).toEqual({
      executable: "/opt/lark-cli",
      args: [
        "im",
        "+messages-search",
        "--as",
        "user",
        "--query",
        "",
        "--start",
        "2026-07-23T01:00:00.000Z",
        "--end",
        "2026-07-24T01:00:00.000Z",
        "--page-size",
        "20",
        "--format",
        "json"
      ]
    });
    expect(JSON.parse(pulled.checkpoint)).toMatchObject({
      pageToken: "lark-page-2",
      start: "2026-07-23T01:00:00.000Z",
      end: "2026-07-24T01:00:00.000Z"
    });
    expect(runner.invocations[2]?.args).toEqual([
      "im",
      "+messages-send",
      "--as",
      "user",
      "--chat-id",
      "lark-chat-1",
      "--text",
      "用户确认后的回复",
      "--idempotency-key",
      "send-key-1",
      "--format",
      "json"
    ]);
  });

  it("uses dws chat message list-all and send commands", async () => {
    const runner = new RecordingRunner([
      JSON.stringify({ authenticated: true }),
      JSON.stringify({
        result: {
          messages: [
            {
              messageId: "ding-message-1",
              conversationId: "ding-chat-1",
              senderId: "ding-user-1",
              text: "钉钉消息",
              createdAt: "2026-07-24T09:00:00+08:00"
            }
          ],
          hasMore: true,
          nextCursor: "ding-page-2"
        }
      }),
      JSON.stringify({ messageId: "ding-sent-1" })
    ]);
    const adapter = new DingTalkDwsAdapter(
      {
        executable: "/opt/dws",
        accountId: "ding-account",
        now: () => new Date("2026-07-24T01:00:00.000Z")
      },
      runner
    );

    await expect(adapter.health()).resolves.toBe("ready");
    const pulled = await adapter.pull({
      accountId: "ding-account",
      checkpoint: null,
      limit: 20
    });
    await adapter.send(
      sendInput("ding-account", "ding-chat-1")
    );

    expect(runner.invocations[0]?.args).toEqual([
      "auth",
      "status",
      "--format",
      "json"
    ]);
    expect(runner.invocations[1]?.args).toEqual([
      "chat",
      "message",
      "list-all",
      "--start",
      "2026-07-23 09:00:00",
      "--end",
      "2026-07-24 09:00:00",
      "--limit",
      "20",
      "--cursor",
      "0",
      "--format",
      "json"
    ]);
    expect(JSON.parse(pulled.checkpoint)).toMatchObject({
      cursor: "ding-page-2",
      start: "2026-07-23T01:00:00.000Z",
      end: "2026-07-24T01:00:00.000Z"
    });
    expect(runner.invocations[2]).toEqual({
      executable: "/opt/dws",
      args: [
        "chat",
        "message",
        "send",
        "--group",
        "ding-chat-1",
        "--title",
        "Hush 回复",
        "--text",
        "@-",
        "--yes",
        "--format",
        "json"
      ],
      input: "用户确认后的回复",
      ambiguousOnTimeout: true
    });
  });

  it("rejects incomplete provider envelopes instead of advancing checkpoints", async () => {
    const lark = new LarkCliAdapter(
      {
        executable: "/opt/lark-cli",
        accountId: "lark-account",
        now: () => new Date("2026-07-24T01:00:00.000Z")
      },
      new RecordingRunner([
        JSON.stringify({ items: [], has_more: true })
      ])
    );
    const dingtalk = new DingTalkDwsAdapter(
      {
        executable: "/opt/dws",
        accountId: "ding-account",
        now: () => new Date("2026-07-24T01:00:00.000Z")
      },
      new RecordingRunner([
        JSON.stringify({ result: { hasMore: false } })
      ])
    );

    await expect(
      lark.pull({
        accountId: "lark-account",
        checkpoint: null,
        limit: 20
      })
    ).rejects.toMatchObject({
      code: "INBOX_PROVIDER_UNAVAILABLE"
    });
    await expect(
      dingtalk.pull({
        accountId: "ding-account",
        checkpoint: null,
        limit: 20
      })
    ).rejects.toMatchObject({
      code: "INBOX_PROVIDER_UNAVAILABLE"
    });
  });
});

class RecordingRunner implements CommandRunner {
  readonly invocations: CommandInvocation[] = [];

  constructor(private readonly outputs: string[]) {}

  async run(invocation: CommandInvocation): Promise<string> {
    this.invocations.push(structuredClone(invocation));
    return this.outputs.shift() ?? "{}";
  }
}

function sendInput(accountId: string, conversationId: string) {
  return {
    draftId: "draft-1",
    inboxItemId: "item-1",
    accountId,
    conversationId,
    providerMessageId: "message-1",
    replyTo: "sender-1",
    recipients: [accountId],
    subject: null,
    content: "用户确认后的回复",
    contentType: "text" as const,
    idempotencyKey: "send-key-1"
  };
}
