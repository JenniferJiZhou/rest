import type { InboxProvider } from "../../src/domain/contracts.js";
import { describe, expect, it } from "vitest";
import {
  FixtureInboxSender,
  FixtureInboxSource
} from "../../src/inbox/providers/provider-fixtures.js";
import { DingTalkDwsAdapter } from "../../src/inbox/providers/dingtalk-dws-adapter.js";
import { defineInboxProviderContract } from "./inbox-provider.contract.js";

for (const provider of [
  "feishu",
  "dingtalk",
  "outlook",
  "qq_mail"
] as const) {
  defineInboxProviderContract(
    `Fixture ${provider}`,
    () => ({
      source: new FixtureInboxSource(provider),
      sender: new FixtureInboxSender(provider),
      accountId: `${provider}-account`,
      sendInput: sendInput(provider)
    })
  );
}

describe("Fixture Feishu participant privacy", () => {
  it("keeps Feishu participant IDs in a private binding behind a hashed reference", async () => {
    const source = new FixtureInboxSource("feishu");
    const result = await source.pull({
      accountId: "feishu-account",
      checkpoint: null,
      limit: 20
    });

    expect(result.participantBindings).toEqual([
      expect.objectContaining({
        participantRef: expect.stringMatching(
          /^participant_[a-zA-Z0-9_-]{32}$/
        )
      })
    ]);
    expect(result.items[0]?.sender_ref).toBe(
      result.participantBindings[0]?.participantRef
    );
    expect(JSON.stringify(result.items)).not.toContain(
      result.participantBindings[0]?.providerParticipantId
    );
  });
});

describe("DingTalk participant privacy", () => {
  it("keeps grouped DWS participant IDs in private bindings behind hashed references", async () => {
    const source = new DingTalkDwsAdapter(
      { executable: "/opt/dws", accountId: "dingtalk-account" },
      {
        async run() {
          return JSON.stringify({
            result: {
              conversationMessagesList: [
                {
                  title: "产品讨论组",
                  openConversationId: "ding-chat-demo",
                  conversationType: "2",
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
              hasMore: false
            }
          });
        }
      }
    );
    const result = await source.pull({
      accountId: "dingtalk-account",
      checkpoint: null,
      limit: 20
    });

    expect(result.participantBindings).toEqual([
      expect.objectContaining({
        participantRef: expect.stringMatching(
          /^participant_[a-zA-Z0-9_-]{32}$/
        ),
        providerParticipantId: "private_dingtalk_user"
      })
    ]);
    expect(result.items[0]?.sender_ref).toBe(
      result.participantBindings[0]?.participantRef
    );
    expect(JSON.stringify(result.items)).not.toContain(
      "private_dingtalk_user"
    );
  });
});

function sendInput(provider: InboxProvider) {
  return {
    draftId: `${provider}-draft`,
    inboxItemId: `${provider}-item`,
    accountId: `${provider}-account`,
    conversationId: `${provider}-conversation`,
    conversationType: "direct" as const,
    providerMessageId: `${provider}-message`,
    replyTo: `${provider}-sender@example.com`,
    recipients: [`${provider}-account@example.com`],
    subject: "回复主题",
    content: "用户确认后的回复",
    contentType: "text" as const,
    idempotencyKey: `${provider}-send-key`,
    mentions: []
  };
}
