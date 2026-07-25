import { describe, expect, it, vi } from "vitest";
import {
  OutlookGraphAdapter,
  type GraphFetch
} from "../../src/inbox/providers/outlook-graph-adapter.js";

describe("OutlookGraphAdapter", () => {
  it("reports ready only after a Graph credential check", async () => {
    const request = vi
      .fn<GraphFetch>()
      .mockResolvedValue(Response.json({ id: "graph-user-1" }));
    const adapter = new OutlookGraphAdapter(
      {
        accountId: "hush@example.com",
        accessToken: async () => "graph-access-value"
      },
      request
    );

    await expect(adapter.health()).resolves.toBe("ready");
    expect(request).toHaveBeenCalledWith(
      "https://graph.microsoft.com/v1.0/me?$select=id",
      expect.objectContaining({
        headers: { Authorization: "Bearer graph-access-value" }
      })
    );
  });

  it("pulls a delta page and normalizes messages", async () => {
    const request = vi.fn<GraphFetch>().mockResolvedValue(
      Response.json({
        value: [
          {
            id: "graph-message-1",
            conversationId: "graph-thread-1",
            from: { emailAddress: { address: "sender@example.com" } },
            toRecipients: [
              { emailAddress: { address: "hush@example.com" } }
            ],
            subject: "Outlook 消息",
            bodyPreview: "请确认时间。",
            receivedDateTime: "2026-07-24T01:00:00Z"
          }
        ],
        "@odata.deltaLink":
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=final"
      })
    );
    const adapter = new OutlookGraphAdapter(
      {
        accountId: "hush@example.com",
        accessToken: async () => "graph-access-value"
      },
      request
    );

    const result = await adapter.pull({
      accountId: "hush@example.com",
      checkpoint: null,
      limit: 20
    });

    expect(result.checkpoint).toBe(
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=final"
    );
    expect(result.items[0]).toMatchObject({
      provider: "outlook",
      provider_message_id: "graph-message-1",
      sender: "sender@example.com"
    });
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer graph-access-value"
    });
  });

  it("rejects a checkpoint outside the Microsoft Graph delta endpoint", async () => {
    const request = vi.fn<GraphFetch>();
    const accessToken = vi.fn(async () => "graph-access-value");
    const adapter = new OutlookGraphAdapter(
      {
        accountId: "hush@example.com",
        accessToken
      },
      request
    );

    await expect(
      adapter.pull({
        accountId: "hush@example.com",
        checkpoint: "https://attacker.example/collect",
        limit: 20
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      statusCode: 400
    });
    expect(accessToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("sends a confirmed reply and never exposes the token in errors", async () => {
    const request = vi
      .fn<GraphFetch>()
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(
        new Response("token graph-access-value", { status: 500 })
      );
    const adapter = new OutlookGraphAdapter(
      {
        accountId: "hush@example.com",
        accessToken: async () => "graph-access-value"
      },
      request
    );

    await expect(adapter.send(sendInput())).resolves.toMatchObject({
      provider: "outlook",
      status: "sent"
    });
    const error = await captureError(() => adapter.send(sendInput()));
    expect(JSON.stringify(error)).not.toContain("graph-access-value");
  });
});

function sendInput() {
  return {
    draftId: "draft-1",
    inboxItemId: "item-1",
    accountId: "hush@example.com",
    conversationId: "thread-1",
    conversationType: "direct" as const,
    providerMessageId: "graph-message-1",
    replyTo: "sender@example.com",
    recipients: ["hush@example.com"],
    subject: "Outlook 消息",
    content: "收到，谢谢。",
    contentType: "text" as const,
    idempotencyKey: "outlook-send-key",
    mentions: []
  };
}

async function captureError(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail.");
}
