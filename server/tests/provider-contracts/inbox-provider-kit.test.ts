import type { InboxProvider } from "../../src/domain/contracts.js";
import { describe, expect, it } from "vitest";
import {
  FixtureInboxSender,
  FixtureInboxSource
} from "../../src/inbox/providers/provider-fixtures.js";
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

describe("Fixture participant privacy", () => {
  it("keeps provider participant IDs in private bindings only", async () => {
    const source = new FixtureInboxSource("feishu");
    const result = await source.pull({
      accountId: "feishu-account",
      checkpoint: null,
      limit: 20
    });

    expect(result.participantBindings).toHaveLength(1);
    expect(result.items[0]?.sender_ref).toBe(
      result.participantBindings[0]?.participantRef
    );
    expect(JSON.stringify(result.items)).not.toContain(
      result.participantBindings[0]?.providerParticipantId
    );
  });
});

function sendInput(provider: InboxProvider) {
  return {
    draftId: `${provider}-draft`,
    inboxItemId: `${provider}-item`,
    accountId: `${provider}-account`,
    conversationId: `${provider}-conversation`,
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
