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
      JSON.stringify({
        items: [
          {
            message_id: "lark-message-1",
            chat_id: "lark-chat-1",
            sender_id: "lark-user-1",
            text: "飞书消息",
            create_time: "2026-07-24T09:00:00+08:00"
          }
        ],
        checkpoint: "lark-checkpoint-1"
      }),
      JSON.stringify({ message_id: "lark-sent-1" })
    ]);
    const adapter = new LarkCliAdapter(
      { executable: "/opt/lark-cli", accountId: "lark-account" },
      runner
    );

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
      content: "飞书消息"
    });
    expect(sent.status).toBe("sent");
    expect(runner.invocations[0]).toMatchObject({
      executable: "/opt/lark-cli",
      args: expect.arrayContaining(["im", "+messages-list"])
    });
    expect(runner.invocations[1]?.args).toEqual(
      expect.arrayContaining(["im", "+messages-send", "--as", "user"])
    );
  });

  it("uses dws chat message list-all and send commands", async () => {
    const runner = new RecordingRunner([
      JSON.stringify({
        messages: [
          {
            messageId: "ding-message-1",
            conversationId: "ding-chat-1",
            senderId: "ding-user-1",
            text: "钉钉消息",
            createdAt: "2026-07-24T09:00:00+08:00"
          }
        ],
        checkpoint: "ding-checkpoint-1"
      }),
      JSON.stringify({ messageId: "ding-sent-1" })
    ]);
    const adapter = new DingTalkDwsAdapter(
      { executable: "/opt/dws", accountId: "ding-account" },
      runner
    );

    await adapter.pull({
      accountId: "ding-account",
      checkpoint: null,
      limit: 20
    });
    await adapter.send(
      sendInput("ding-account", "ding-chat-1")
    );

    expect(runner.invocations[0]?.args.slice(0, 3)).toEqual([
      "chat",
      "message",
      "list-all"
    ]);
    expect(runner.invocations[1]?.args.slice(0, 3)).toEqual([
      "chat",
      "message",
      "send"
    ]);
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
