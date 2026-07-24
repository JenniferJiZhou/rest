import { describe, expect, it } from "vitest";
import {
  QqMailAdapter,
  type QqMailRuntime
} from "../../src/inbox/providers/qq-mail-adapter.js";

describe("QqMailAdapter", () => {
  it("uses UID checkpoints and preserves reply headers", async () => {
    const runtime = new FixtureRuntime();
    const adapter = new QqMailAdapter(
      {
        accountId: "123456@qq.com",
        credentials: async () => ({
          address: "123456@qq.com",
          authorizationCode: "not-returned"
        })
      },
      runtime
    );

    await expect(adapter.health()).resolves.toBe("ready");
    const pulled = await adapter.pull({
      accountId: "123456@qq.com",
      checkpoint: "40",
      limit: 20
    });
    const sent = await adapter.send(sendInput());

    expect(runtime.lastUid).toBe(40);
    expect(pulled.checkpoint).toBe("41");
    expect(pulled.items[0]).toMatchObject({
      provider: "qq_mail",
      provider_message_id: "qq-message-41"
    });
    expect(runtime.sent).toMatchObject({
      to: "sender@example.com",
      subject: "Re: 项目确认",
      inReplyTo: "qq-message-41",
      references: ["qq-message-41"]
    });
    expect(sent.status).toBe("sent");
    expect(JSON.stringify(pulled)).not.toContain("not-returned");
  });

  it("returns unknown on SMTP timeout without retrying", async () => {
    const runtime = new FixtureRuntime();
    runtime.timeout = true;
    const adapter = new QqMailAdapter(
      {
        accountId: "123456@qq.com",
        credentials: async () => ({
          address: "123456@qq.com",
          authorizationCode: "not-returned"
        })
      },
      runtime
    );

    await expect(adapter.send(sendInput())).resolves.toMatchObject({
      status: "unknown",
      provider_message_id: null
    });
    expect(runtime.sendCount).toBe(1);
  });
});

class FixtureRuntime implements QqMailRuntime {
  healthCount = 0;
  lastUid: number | null = null;
  sent: Record<string, unknown> | null = null;
  sendCount = 0;
  timeout = false;

  async health() {
    this.healthCount += 1;
  }

  async pull(
    _credentials: {
      address: string;
      authorizationCode: string;
    },
    afterUid: number | null
  ) {
    this.lastUid = afterUid;
    return {
      messages: [
        {
          uid: 41,
          messageId: "qq-message-41",
          from: "sender@example.com",
          to: ["123456@qq.com"],
          subject: "项目确认",
          text: "请确认项目时间。",
          receivedAt: "2026-07-24T01:00:00.000Z"
        }
      ],
      checkpoint: 41
    };
  }

  async send(
    _credentials: {
      address: string;
      authorizationCode: string;
    },
    message: Record<string, unknown>
  ) {
    this.sendCount += 1;
    this.sent = structuredClone(message);
    if (this.timeout) {
      const error = new Error("socket timed out") as Error & {
        code: string;
      };
      error.code = "ETIMEDOUT";
      throw error;
    }
    return { messageId: "qq-sent-1" };
  }
}

function sendInput() {
  return {
    draftId: "draft-1",
    inboxItemId: "item-1",
    accountId: "123456@qq.com",
    conversationId: null,
    providerMessageId: "qq-message-41",
    replyTo: "sender@example.com",
    recipients: ["123456@qq.com"],
    subject: "项目确认",
    content: "收到，谢谢。",
    contentType: "text" as const,
    idempotencyKey: "qq-send-key"
  };
}
