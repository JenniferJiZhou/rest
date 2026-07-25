import { describe, expect, it } from "vitest";
import { unifiedInboxItemSchema } from "../../src/domain/contracts.js";
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
            chat_type: "p2p",
            chat_partner: {
              name: "飞书私聊"
            },
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
      conversation_type: "direct",
      conversation_name: "飞书私聊",
      sender: "飞书用户",
      sender_ref: expect.stringMatching(/^participant_/),
      content: "飞书消息",
      received_at: "2026-07-24T01:00:00.000Z"
    });
    expect(pulled.participantBindings).toEqual([
      expect.objectContaining({
        provider: "feishu",
        accountId: "lark-account",
        conversationId: "lark-chat-1",
        participantRef: pulled.items[0]?.sender_ref,
        providerParticipantId: "lark-user-1",
        displayName: "飞书用户"
      })
    ]);
    expect(JSON.stringify(pulled.items)).not.toContain("lark-user-1");
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

  it("keeps the flat DWS messages envelope compatible", async () => {
    const runner = new RecordingRunner([
      JSON.stringify({ authenticated: true }),
      JSON.stringify({
        result: {
          messages: [
            {
              messageId: "ding-message-1",
              conversationId: "ding-chat-1",
              conversationType: "p2p",
              conversationName: "钉钉私聊",
              senderId: "ding-user-1",
              senderName: "钉钉用户",
              text: "钉钉消息",
              createdAt: "2026-07-24T09:00:00+08:00"
            }
          ],
          hasMore: true,
          nextCursor: "ding-page-2"
        }
      })
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
    expect(pulled.items[0]).toMatchObject({
      conversation_type: "direct",
      conversation_name: "钉钉私聊",
      sender: "钉钉用户",
      sender_ref: expect.stringMatching(/^participant_/)
    });
    expect(pulled.participantBindings).toEqual([
      expect.objectContaining({
        providerParticipantId: "ding-user-1",
        displayName: "钉钉用户"
      })
    ]);
    expect(JSON.stringify(pulled.items)).not.toContain("ding-user-1");
  });

  it("rejects an incomplete flat DWS message before advancing its checkpoint", async () => {
    const adapter = new DingTalkDwsAdapter(
      { executable: "/opt/dws", accountId: "ding-account" },
      new RecordingRunner([
        JSON.stringify({
          result: {
            messages: [
              {
                messageId: "ding-message-incomplete",
                conversationType: "direct",
                senderId: "private_dingtalk_user",
                senderName: "王同学",
                text: "请确认接口交付时间",
                createdAt: "2026-07-24T09:00:00+08:00"
              }
            ],
            hasMore: true,
            nextCursor: "20"
          }
        })
      ])
    );

    let error: unknown;
    try {
      await adapter.pull({
        accountId: "ding-account",
        checkpoint: null,
        limit: 20
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "INBOX_PROVIDER_UNAVAILABLE",
      details: { provider: "dingtalk", reason: "invalid_output" }
    });
    expect(JSON.stringify(error)).not.toContain("private_dingtalk_user");
  });

  it("rejects a grouped DWS message without its inherited conversation ID", async () => {
    const adapter = new DingTalkDwsAdapter(
      { executable: "/opt/dws", accountId: "ding-account" },
      new RecordingRunner([
        JSON.stringify({
          result: {
            conversationMessagesList: [
              {
                title: "产品讨论组",
                conversationType: "group",
                messages: [
                  {
                    messageId: "ding-message-incomplete",
                    senderOpenDingTalkId: "private_dingtalk_user",
                    senderName: "王同学",
                    text: "请确认接口交付时间",
                    createTime: "2026-07-24T09:00:00+08:00"
                  }
                ]
              }
            ],
            hasMore: false
          }
        })
      ])
    );

    let error: unknown;
    try {
      await adapter.pull({
        accountId: "ding-account",
        checkpoint: null,
        limit: 20
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "INBOX_PROVIDER_UNAVAILABLE",
      details: { provider: "dingtalk", reason: "invalid_output" }
    });
    expect(JSON.stringify(error)).not.toContain("private_dingtalk_user");
  });

  it("normalizes grouped DWS conversation batches and sends group mentions", async () => {
    const runner = new RecordingRunner([
      JSON.stringify({
        result: {
          conversationMessagesList: [
            {
              title: "产品讨论组",
              openConversationId: "ding-chat-demo",
              conversationType: "group",
              messages: [
                {
                  messageId: "ding-message-demo",
                  senderOpenDingTalkId: "private_dingtalk_user",
                  senderName: "王同学",
                  text: "请确认接口交付时间",
                  createTime: "2026-07-24T09:00:00+08:00"
                }
              ]
            }
          ],
          hasMore: true,
          nextCursor: "20"
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

    const pulled = await adapter.pull({
      accountId: "ding-account",
      checkpoint: null,
      limit: 20
    });
    const participant = pulled.participantBindings[0]!;
    await adapter.send({
      ...sendInput("ding-account", "ding-chat-demo"),
      conversationType: "group",
      replyTo: null,
      mentions: [
        {
          participantRef: participant.participantRef,
          providerParticipantId: "private_dingtalk_user",
          displayName: "王同学"
        }
      ]
    });

    expect(pulled.items[0]).toMatchObject({
      provider: "dingtalk",
      conversation_id: "ding-chat-demo",
      conversation_type: "group",
      conversation_name: "产品讨论组",
      sender: "王同学",
      sender_ref: expect.stringMatching(/^participant_/),
      content: "请确认接口交付时间"
    });
    expect(pulled.participantBindings).toEqual([
      expect.objectContaining({
        provider: "dingtalk",
        accountId: "ding-account",
        conversationId: "ding-chat-demo",
        participantRef: pulled.items[0]?.sender_ref,
        providerParticipantId: "private_dingtalk_user",
        displayName: "王同学"
      })
    ]);
    expect(JSON.stringify(pulled.items)).not.toContain("private_dingtalk_user");
    expect(JSON.parse(pulled.checkpoint)).toMatchObject({ cursor: "20" });
    expect(runner.invocations[0]?.args).toEqual([
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
    expect(runner.invocations[1]).toEqual({
      executable: "/opt/dws",
      args: [
        "chat",
        "message",
        "send",
        "--group",
        "ding-chat-demo",
        "--title",
        "Hush 回复",
        "--text",
        "<@private_dingtalk_user>\n用户确认后的回复",
        "--at-open-dingtalk-ids",
        "private_dingtalk_user",
        "--uuid",
        "send-key-1",
        "--format",
        "json"
      ],
      ambiguousOnTimeout: true
    });
  });

  it("sends a direct DWS reply to the resolved private participant", async () => {
    const runner = new RecordingRunner([
      JSON.stringify({ messageId: "ding-direct-sent-1" })
    ]);
    const adapter = new DingTalkDwsAdapter(
      { executable: "/opt/dws", accountId: "ding-account" },
      runner
    );

    await adapter.send({
      ...sendInput("ding-account", "ding-direct-conversation"),
      conversationType: "direct",
      mentions: [
        {
          participantRef: "participant_private_dingtalk_user",
          providerParticipantId: "private_dingtalk_user",
          displayName: "王同学"
        }
      ]
    });

    expect(runner.invocations).toEqual([
      {
        executable: "/opt/dws",
        args: [
          "chat",
          "message",
          "send",
          "--open-dingtalk-id",
          "private_dingtalk_user",
          "--text",
          "用户确认后的回复",
          "--uuid",
          "send-key-1",
          "--format",
          "json"
        ],
        ambiguousOnTimeout: true
      }
    ]);
  });

  it("does not send a direct DWS reply without a resolved private participant", async () => {
    const runner = new RecordingRunner([]);
    const adapter = new DingTalkDwsAdapter(
      { executable: "/opt/dws", accountId: "ding-account" },
      runner
    );

    await expect(
      adapter.send({
        ...sendInput("ding-account", "ding-direct-conversation"),
        conversationType: "direct",
        mentions: []
      })
    ).rejects.toMatchObject({
      code: "INBOX_PROVIDER_UNAVAILABLE",
      details: { provider: "dingtalk", reason: "participant_unavailable" }
    });
    expect(runner.invocations).toEqual([]);
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

  it("maps known group envelopes and supports public digest redaction", async () => {
    const runner = new RecordingRunner([
      JSON.stringify({
        items: [
          {
            message_id: "lark-group-message-1",
            chat_id: "lark-group-1",
            chat_type: "group",
            chat_name: "产品讨论组",
            sender: {
              id: "ou_private_feishu",
              name: "王同学"
            },
            content: "请确认接口交付时间",
            create_time: "1784854800000"
          }
        ],
        has_more: false
      }),
      JSON.stringify({ message_id: "lark-group-sent-1" })
    ]);
    const adapter = new LarkCliAdapter(
      {
        executable: "/opt/lark-cli",
        accountId: "lark-account"
      },
      runner
    );

    const pulled = await adapter.pull({
      accountId: "lark-account",
      checkpoint: null,
      limit: 20
    });
    const sourceEvent = pulled.items[0]!;

    const dingtalk = new DingTalkDwsAdapter(
      { executable: "/opt/dws", accountId: "ding-account" },
      new RecordingRunner([
        JSON.stringify({
          result: {
            messages: [
              {
                messageId: "ding-group-message-1",
                conversationId: "ding-group-1",
                conversationType: "GROUP",
                conversationName: "产品讨论组",
                sender: { name: "王同学" },
                text: "请确认接口交付时间",
                createdAt: "2026-07-24T09:00:00+08:00"
              }
            ],
            hasMore: false
          }
        })
      ])
    );
    const dingtalkPulled = await dingtalk.pull({
      accountId: "ding-account",
      checkpoint: null,
      limit: 20
    });

    expect(sourceEvent).toMatchObject({
      conversation_type: "group",
      conversation_name: "产品讨论组",
      sender: "王同学",
      sender_ref: expect.stringMatching(/^participant_/)
    });
    expect(sourceEvent.sender_ref).not.toBe("ou_private_feishu");
    expect(JSON.stringify(pulled.items)).not.toContain("ou_private_feishu");
    expect(pulled.participantBindings).toEqual([
      {
        provider: "feishu",
        accountId: "lark-account",
        conversationId: "lark-group-1",
        participantRef: sourceEvent.sender_ref,
        providerParticipantId: "ou_private_feishu",
        displayName: "王同学"
      }
    ]);

    await adapter.send({
      ...sendInput("lark-account", "lark-group-1"),
      mentions: [
        {
          participantRef: sourceEvent.sender_ref!,
          providerParticipantId: "ou_private_feishu",
          displayName: "王同学"
        }
      ]
    });
    const sendArgs = runner.invocations[1]!.args;
    expect(sendArgs[sendArgs.indexOf("--text") + 1]).toBe(
      '<at user_id="ou_private_feishu">王同学</at>\n用户确认后的回复'
    );
    expect(dingtalkPulled.items[0]).toMatchObject({
      conversation_type: "group",
      conversation_name: "产品讨论组",
      sender: "王同学"
    });
    expect(
      unifiedInboxItemSchema.parse({
        id: "inbox-group-1",
        ...sourceEvent,
        sender: null,
        sender_ref: null,
        content: null,
        item_kind: "conversation_digest",
        revision: 1,
        message_count: 1,
        window_started_at: sourceEvent.received_at,
        window_ended_at: sourceEvent.received_at,
        sealed_at: null,
        acknowledged_at: null,
        summary: "产品讨论组需要确认接口交付时间。",
        important_points: [],
        todos: [],
        priority: "normal",
        needs_reply: true,
        reply_targets: [],
        draft_id: null,
        sync_status: "ready"
      })
    ).toMatchObject({ sender: null, content: null });
  });

  it("renders Feishu mention content without public provider IDs", async () => {
    const runner = new RecordingRunner([
      JSON.stringify({
        items: [
          {
            message_id: "lark-mention-markup",
            chat_id: "lark-group-mentions",
            chat_type: "group",
            chat_name: "产品讨论组",
            sender: {
              id: "ou_private_sender",
              name: "王同学"
            },
            content:
              '<at user_id="ou_private_markup">李同学</at> 请确认接口交付时间',
            create_time: "1784854800000"
          },
          {
            message_id: "lark-mention-structured",
            chat_id: "lark-group-mentions",
            chat_type: "group",
            chat_name: "产品讨论组",
            sender: {
              id: "ou_private_sender",
              name: "王同学"
            },
            content: JSON.stringify({
              text: '<at user_id="ou_private_structured">陈同学</at> 已确认',
              mentions: [
                {
                  user_id: "ou_private_structured",
                  name: "陈同学"
                }
              ]
            }),
            create_time: "1784854800000"
          }
        ],
        has_more: false
      })
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

    expect(pulled.items.map((item) => item.content)).toEqual([
      "李同学 请确认接口交付时间",
      "陈同学 已确认"
    ]);
    expect(JSON.stringify(pulled.items)).not.toContain("ou_private_markup");
    expect(JSON.stringify(pulled.items)).not.toContain(
      "ou_private_structured"
    );
  });

  it("preserves brace-prefixed text and ignores private structured fields", async () => {
    const adapter = new LarkCliAdapter(
      { executable: "/opt/lark-cli", accountId: "lark-account" },
      new RecordingRunner([
        JSON.stringify({
          items: [
            {
              message_id: "lark-brace-text",
              chat_id: "lark-group-mentions",
              chat_type: "group",
              chat_name: "产品讨论组",
              sender: { id: "ou_private_sender", name: "王同学" },
              content: "{hello",
              create_time: "1784854800000"
            },
            {
              message_id: "lark-structured-extra",
              chat_id: "lark-group-mentions",
              chat_type: "group",
              chat_name: "产品讨论组",
              sender: { id: "ou_private_sender", name: "王同学" },
              content: JSON.stringify({
                text: "已确认",
                message_type: "text",
                private_metadata: "ou_private_metadata"
              }),
              create_time: "1784854800000"
            }
          ],
          has_more: false
        })
      ])
    );

    const pulled = await adapter.pull({
      accountId: "lark-account",
      checkpoint: null,
      limit: 20
    });

    expect(pulled.items.map((item) => item.content)).toEqual([
      "{hello",
      "已确认"
    ]);
    expect(JSON.stringify(pulled.items)).not.toContain("ou_private_metadata");
  });

  it("rejects unsafe Feishu structured content without leaking mention IDs", async () => {
    const adapter = new LarkCliAdapter(
      { executable: "/opt/lark-cli", accountId: "lark-account" },
      new RecordingRunner([
        JSON.stringify({
          items: [
            {
              message_id: "lark-mention-incomplete",
              chat_id: "lark-group-mentions",
              chat_type: "group",
              chat_name: "产品讨论组",
              sender: {
                id: "ou_private_sender",
                name: "王同学"
              },
              content: {
                text: "请确认接口交付时间",
                mentions: [{ user_id: "ou_private_incomplete" }]
              },
              create_time: "1784854800000"
            }
          ],
          has_more: false
        })
      ])
    );

    let error: unknown;
    try {
      await adapter.pull({
        accountId: "lark-account",
        checkpoint: null,
        limit: 20
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "INBOX_PROVIDER_UNAVAILABLE",
      details: { provider: "feishu", reason: "invalid_output" }
    });
    expect(JSON.stringify(error)).not.toContain("ou_private_incomplete");
  });

  it("rejects incomplete Feishu envelopes without leaking private IDs", async () => {
    const lark = new LarkCliAdapter(
      { executable: "/opt/lark-cli", accountId: "lark-account" },
      new RecordingRunner([
        JSON.stringify({
          items: [
            {
              message_id: "lark-missing-type",
              chat_id: "lark-chat-1",
              sender: {
                id: "ou_private_incomplete",
                name: "飞书用户"
              },
              content: "消息",
              create_time: "1784854800000"
            },
            {
              message_id: "lark-unknown-type",
              chat_id: "lark-chat-2",
              chat_type: "channel",
              sender: "飞书用户",
              content: "消息",
              create_time: "1784854800000"
            }
          ],
          has_more: false
        })
      ])
    );
    const dingtalk = new DingTalkDwsAdapter(
      { executable: "/opt/dws", accountId: "ding-account" },
      new RecordingRunner([
        JSON.stringify({
          result: {
            messages: [
              {
                messageId: "ding-missing-type",
                conversationId: "ding-chat-1",
                sender: "钉钉用户",
                text: "消息",
                createdAt: "2026-07-24T09:00:00+08:00"
              },
              {
                messageId: "ding-unknown-type",
                conversationId: "ding-chat-2",
                conversationType: "channel",
                sender: "钉钉用户",
                text: "消息",
                createdAt: "2026-07-24T09:00:00+08:00"
              }
            ],
            hasMore: false
          }
        })
      ])
    );

    let larkError: unknown;
    try {
      await lark.pull({
        accountId: "lark-account",
        checkpoint: null,
        limit: 20
      });
    } catch (error) {
      larkError = error;
    }
    expect(larkError).toMatchObject({
      code: "INBOX_PROVIDER_UNAVAILABLE",
      details: { provider: "feishu", reason: "invalid_output" }
    });
    expect(JSON.stringify(larkError)).not.toContain(
      "ou_private_incomplete"
    );
    await expect(
      dingtalk.pull({ accountId: "ding-account", checkpoint: null, limit: 20 })
    ).rejects.toMatchObject({
      code: "INBOX_PROVIDER_UNAVAILABLE",
      details: { provider: "dingtalk", reason: "invalid_output" }
    });
  });

  it("does not expose provider user IDs as sender display names", async () => {
    const adapter = new DingTalkDwsAdapter(
      { executable: "/opt/dws", accountId: "ding-account" },
      new RecordingRunner([
        JSON.stringify({
          result: {
            messages: [
              {
                messageId: "ding-id-only",
                conversationId: "ding-chat-1",
                conversationType: "direct",
                senderId: "provider-user-id-should-not-leak",
                text: "消息",
                createdAt: "2026-07-24T09:00:00+08:00"
              }
            ],
            hasMore: false
          }
        })
      ])
    );

    const pulled = await adapter.pull({
      accountId: "ding-account",
      checkpoint: null,
      limit: 20
    });

    expect(pulled.items[0]?.sender).toBe("未知发送者");
    expect(pulled.items[0]?.sender).not.toContain("provider-user-id");
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
    conversationType: "group" as const,
    providerMessageId: "message-1",
    replyTo: "sender-1",
    recipients: [accountId],
    subject: null,
    content: "用户确认后的回复",
    contentType: "text" as const,
    idempotencyKey: "send-key-1",
    mentions: []
  };
}
