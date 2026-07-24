import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/domain/errors.js";
import type {
  DraftRequest,
  MailItem,
  MailProvider,
  ProviderCallOptions
} from "../../src/domain/ports.js";

export type MailProviderScenario =
  | "ready"
  | "empty"
  | "unavailable"
  | "timeout"
  | "draft_failure";

export interface MailProviderContractHarness {
  provider: MailProvider;
  setScenario(scenario: MailProviderScenario): Promise<void> | void;
  createdDraftCount(dedupeKey: string): Promise<number> | number;
}

export interface MailProviderContractOptions {
  name: string;
  createHarness(): MailProviderContractHarness;
}

const sampleDraft: DraftRequest = {
  forItemId: "mail_contract_1",
  threadId: "thread_contract_1",
  to: "receiver@example.com",
  subject: "Re: Contract test",
  bodyText: "Draft created by provider contract test.",
  dedupeKey: "mail-contract-dedupe-1"
};

export function defineMailProviderContractTests(
  options: MailProviderContractOptions
): void {
  describe(`${options.name} MailProvider contract`, () => {
    let harness: MailProviderContractHarness;

    beforeEach(() => {
      harness = options.createHarness();
    });

    it("fetchUnread returns normalized MailItem values", async () => {
      await harness.setScenario("ready");
      const items = await harness.provider.fetchUnread({
        accountId: "contract-account",
        since: "2026-07-24T20:00:00+08:00",
        maxItems: 10
      });

      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        assertMailItem(item);
      }
    });

    it("fetchUnread represents an empty mailbox as an empty array", async () => {
      await harness.setScenario("empty");
      await expect(
        harness.provider.fetchUnread({
          accountId: "contract-account",
          since: "2026-07-24T20:00:00+08:00",
          maxItems: 10
        })
      ).resolves.toEqual([]);
    });

    it("maps provider unavailable to a retryable AppError", async () => {
      await harness.setScenario("unavailable");
      const error = await captureError(() =>
        harness.provider.fetchUnread({
          accountId: "contract-account",
          since: "2026-07-24T20:00:00+08:00",
          maxItems: 10
        })
      );
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "GMAIL_UNAVAILABLE",
        retryable: true,
        fallback: "OPEN_LOOPS_ONLY"
      });
    });

    it("maps timeout to a retryable unavailable error", async () => {
      await harness.setScenario("timeout");
      const error = await captureError(() =>
        harness.provider.fetchUnread({
          accountId: "contract-account",
          since: "2026-07-24T20:00:00+08:00",
          maxItems: 10
        })
      );
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "GMAIL_UNAVAILABLE",
        retryable: true,
        fallback: "OPEN_LOOPS_ONLY"
      });
    });

    it("createDraft returns a stable provider draft ID", async () => {
      await harness.setScenario("ready");
      await expect(
        harness.provider.createDraft(sampleDraft)
      ).resolves.toMatchObject({
        draftId: expect.any(String)
      });
    });

    it("maps createDraft failure without sending mail", async () => {
      await harness.setScenario("draft_failure");
      const error = await captureError(() =>
        harness.provider.createDraft(sampleDraft)
      );
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "GMAIL_DRAFT_FAILED",
        retryable: true,
        fallback: "SUMMARY_ONLY"
      });
    });

    it("does not create a second draft for the same dedupe key", async () => {
      await harness.setScenario("ready");
      const first = await harness.provider.createDraft(sampleDraft);
      const second = await harness.provider.createDraft(sampleDraft);

      expect(second.draftId).toBe(first.draftId);
      await expect(
        Promise.resolve(
          harness.createdDraftCount(sampleDraft.dedupeKey)
        )
      ).resolves.toBe(1);
    });

    it("honors an already-aborted fetch signal", async () => {
      const options = abortedOptions();
      await expect(
        harness.provider.fetchUnread(
          {
            accountId: "contract-account",
            since: "2026-07-24T20:00:00+08:00",
            maxItems: 10
          },
          options
        )
      ).rejects.toMatchObject({
        details: { reason: "aborted" }
      });
    });

    it("honors an already-aborted draft signal", async () => {
      await expect(
        harness.provider.createDraft(sampleDraft, abortedOptions())
      ).rejects.toMatchObject({
        details: { reason: "aborted" }
      });
    });
  });
}

function abortedOptions(): ProviderCallOptions {
  const controller = new AbortController();
  controller.abort();
  return { signal: controller.signal };
}

function assertMailItem(item: MailItem): void {
  expect(Object.keys(item).sort()).toEqual(
    [
      "from",
      "id",
      "plainText",
      "receivedAt",
      "replyTo",
      "subject",
      "threadId"
    ].sort()
  );
  expect(item.id).not.toHaveLength(0);
  expect(item.from).not.toHaveLength(0);
  expect(item.subject).toEqual(expect.any(String));
  expect(item.plainText).toEqual(expect.any(String));
  expect(Number.isNaN(Date.parse(item.receivedAt))).toBe(false);
}

async function captureError(
  operation: () => Promise<unknown>
): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected provider operation to reject.");
}
