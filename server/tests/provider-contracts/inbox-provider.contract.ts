import { describe, expect, it } from "vitest";
import type {
  InboxProvider,
  InboxSendResult
} from "../../src/domain/contracts.js";
import type {
  InboxSendInput,
  InboxSender,
  InboxSource
} from "../../src/inbox/ports.js";

export interface InboxProviderHarness {
  source: InboxSource;
  sender: InboxSender;
  accountId: string;
  sendInput: InboxSendInput;
}

export function defineInboxProviderContract(
  name: string,
  createHarness: () => InboxProviderHarness
): void {
  describe(name, () => {
    it("returns normalized events without credentials", async () => {
      const harness = createHarness();
      const result = await harness.source.pull({
        accountId: harness.accountId,
        checkpoint: null,
        limit: 20
      });

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.every(isNormalizedInboxEvent)).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(
        /access_token|refresh_token|secret|auth_code|credential/i
      );
    });

    it("returns a unified send result", async () => {
      const harness = createHarness();
      const result = await harness.sender.send(harness.sendInput);

      expect(["sent", "failed", "unknown"]).toContain(result.status);
      expect(result.provider).toBe(harness.source.provider);
      assertSendResult(result);
    });
  });
}

function isNormalizedInboxEvent(
  value: Record<string, unknown>
): boolean {
  return (
    isProvider(value.provider) &&
    typeof value.account_id === "string" &&
    typeof value.provider_message_id === "string" &&
    typeof value.sender === "string" &&
    Array.isArray(value.recipients) &&
    typeof value.content === "string" &&
    typeof value.received_at === "string" &&
    typeof value.coverage === "object"
  );
}

function isProvider(value: unknown): value is InboxProvider {
  return ["feishu", "dingtalk", "outlook", "qq_mail"].includes(
    String(value)
  );
}

function assertSendResult(result: InboxSendResult): void {
  expect(result.draft_id).not.toHaveLength(0);
  expect(result.provider_message_id === null ||
    result.provider_message_id.length > 0).toBe(true);
}
