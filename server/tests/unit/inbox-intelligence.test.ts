import { describe, expect, it } from "vitest";
import {
  FixtureInboxIntelligenceProvider,
  UnavailableInboxIntelligenceProvider
} from "../../src/inbox/intelligence.js";
import type {
  InboxSummaryInput,
  ReplyDraftInput
} from "../../src/inbox/ports.js";

describe("Inbox intelligence providers", () => {
  it("returns deterministic summaries and drafts from message content", async () => {
    const provider = new FixtureInboxIntelligenceProvider();
    const input = summaryInput();

    await expect(provider.summarize(input)).resolves.toEqual(
      await provider.summarize(input)
    );
    await expect(provider.draftReply(draftInput())).resolves.toEqual({
      content: "收到，我会查看并尽快回复。",
      contentType: "text"
    });
    await expect(provider.health()).resolves.toBe("ready");
  });

  it("keeps credentials and confirmation data outside intelligence inputs", () => {
    const serialized = JSON.stringify({
      summary: summaryInput(),
      draft: draftInput()
    });

    expect(serialized).not.toMatch(
      /access_token|refresh_token|auth_code|confirmation_token|credential/i
    );
  });

  it("fails with a sanitized unavailable error", async () => {
    const provider = new UnavailableInboxIntelligenceProvider();

    await expect(provider.health()).resolves.toBe("unavailable");
    await expect(provider.summarize(summaryInput())).rejects.toMatchObject({
      code: "INBOX_AI_UNAVAILABLE",
      retryable: true,
      details: null
    });
  });
});

function summaryInput(): InboxSummaryInput {
  return {
    provider: "feishu",
    sender: "同事",
    recipients: ["我"],
    subject: null,
    content: "请查看本周计划并回复。",
    receivedAt: "2026-07-24T09:00:00+08:00"
  };
}

function draftInput(): ReplyDraftInput {
  return {
    ...summaryInput(),
    summary: "同事请我查看本周计划。",
    importantPoints: ["查看本周计划"],
    todos: ["回复同事"],
    priority: "normal",
    needsReply: true
  };
}
