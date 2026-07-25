import { describe, expect, it } from "vitest";
import { InMemoryInboxParticipantDirectory } from "../../src/inbox/in-memory.js";

describe("InMemoryInboxParticipantDirectory", () => {
  it("resolves a private provider participant binding in its conversation", async () => {
    const directory = new InMemoryInboxParticipantDirectory();
    const binding = {
      provider: "feishu" as const,
      accountId: "account-demo",
      conversationId: "conversation-demo",
      participantRef: "participant_12345678",
      providerParticipantId: "ou_private_value",
      displayName: "王同学"
    };
    await directory.bindAll([binding]);
    binding.providerParticipantId = "mutated_after_bind";

    const input = {
      provider: "feishu" as const,
      accountId: "account-demo",
      conversationId: "conversation-demo",
      participantRefs: ["participant_12345678"]
    };
    const resolved = await directory.resolve(input);
    expect(resolved).toEqual([
      {
        participantRef: "participant_12345678",
        providerParticipantId: "ou_private_value",
        displayName: "王同学"
      }
    ]);
    resolved[0]!.providerParticipantId = "mutated_after_resolve";
    input.participantRefs[0] = "participant_different";

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

  it("does not resolve a participant binding across provider account or conversation", async () => {
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

    for (const input of [
      {
        provider: "dingtalk" as const,
        accountId: "account-demo",
        conversationId: "conversation-demo"
      },
      {
        provider: "feishu" as const,
        accountId: "different-account",
        conversationId: "conversation-demo"
      },
      {
        provider: "feishu" as const,
        accountId: "account-demo",
        conversationId: "different-conversation"
      }
    ]) {
      await expect(
        directory.resolve({
          ...input,
          participantRefs: ["participant_12345678"]
        })
      ).rejects.toMatchObject({
        code: "INBOX_VERSION_CONFLICT"
      });
    }
  });

  it("uses collision-safe participant binding keys", async () => {
    const directory = new InMemoryInboxParticipantDirectory();
    await directory.bindAll([
      {
        provider: "feishu",
        accountId: "a\u0000b",
        conversationId: "c",
        participantRef: "participant_12345678",
        providerParticipantId: "ou_first",
        displayName: "第一位"
      },
      {
        provider: "feishu",
        accountId: "a",
        conversationId: "b\u0000c",
        participantRef: "participant_12345678",
        providerParticipantId: "ou_second",
        displayName: "第二位"
      }
    ]);

    await expect(
      directory.resolve({
        provider: "feishu",
        accountId: "a\u0000b",
        conversationId: "c",
        participantRefs: ["participant_12345678"]
      })
    ).resolves.toEqual([
      expect.objectContaining({ providerParticipantId: "ou_first" })
    ]);
    await expect(
      directory.resolve({
        provider: "feishu",
        accountId: "a",
        conversationId: "b\u0000c",
        participantRefs: ["participant_12345678"]
      })
    ).resolves.toEqual([
      expect.objectContaining({ providerParticipantId: "ou_second" })
    ]);
  });
});
