import { describe, expect, it } from "vitest";
import { InMemoryInboxParticipantDirectory } from "../../src/inbox/in-memory.js";

describe("InMemoryInboxParticipantDirectory", () => {
  it("resolves a private provider participant binding in its conversation", async () => {
    const directory = new InMemoryInboxParticipantDirectory();
    await directory.bindAll([
      {
        provider: "feishu",
        accountId: "account-demo",
        conversationId: "conversation-demo",
        participantRef: "participant_12345678",
        providerParticipantId: "ou_private_value",
        displayName: "王同学"
      }
    ]);

    await expect(
      directory.resolve({
        provider: "feishu",
        accountId: "account-demo",
        conversationId: "conversation-demo",
        participantRefs: ["participant_12345678"]
      })
    ).resolves.toEqual([
      {
        participantRef: "participant_12345678",
        providerParticipantId: "ou_private_value",
        displayName: "王同学"
      }
    ]);
  });

  it("rejects an unknown participant reference", async () => {
    const directory = new InMemoryInboxParticipantDirectory();

    await expect(
      directory.resolve({
        provider: "feishu",
        accountId: "account-demo",
        conversationId: "conversation-demo",
        participantRefs: ["participant_12345678"]
      })
    ).rejects.toMatchObject({
      code: "INBOX_VERSION_CONFLICT"
    });
  });

  it("does not resolve a participant binding across conversations", async () => {
    const directory = new InMemoryInboxParticipantDirectory();
    await directory.bindAll([
      {
        provider: "feishu",
        accountId: "account-demo",
        conversationId: "conversation-demo",
        participantRef: "participant_12345678",
        providerParticipantId: "ou_private_value",
        displayName: "王同学"
      }
    ]);

    await expect(
      directory.resolve({
        provider: "feishu",
        accountId: "account-demo",
        conversationId: "different-conversation",
        participantRefs: ["participant_12345678"]
      })
    ).rejects.toMatchObject({
      code: "INBOX_VERSION_CONFLICT"
    });
  });
});
