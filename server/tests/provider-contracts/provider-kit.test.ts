import { AppError } from "../../src/domain/errors.js";
import type {
  DraftRequest,
  DraftResult,
  InboundMessage,
  MailFetchContext,
  MailItem,
  MailProvider,
  MessagingChannel,
  OutboundMessage,
  ProviderCallOptions,
  ProviderHealth
} from "../../src/domain/ports.js";
import { InMemoryInboundEventDeduplicator } from "../../src/infra/in-memory.js";
import {
  NormalizedInboundMessageMapper,
  RecordingMessagingChannel,
  UnavailableMessagingChannel
} from "../../src/infra/provider-stubs.js";
import {
  defineMailProviderContractTests,
  type MailProviderContractHarness,
  type MailProviderScenario
} from "./mail-provider.contract.js";
import {
  defineMessagingProviderContractTests,
  type MessagingProviderContractHarness,
  type MessagingProviderScenario
} from "./messaging-channel.contract.js";

class ContractMailProvider implements MailProvider {
  scenario: MailProviderScenario = "ready";
  readonly drafts = new Map<string, DraftResult>();
  readonly draftWrites = new Map<string, number>();

  async health(): Promise<ProviderHealth> {
    return this.scenario === "unavailable" ? "unavailable" : "ready";
  }

  async fetchUnread(
    _context: MailFetchContext,
    options?: ProviderCallOptions
  ): Promise<MailItem[]> {
    assertMailNotAborted(options, "OPEN_LOOPS_ONLY");
    if (this.scenario === "empty") {
      return [];
    }
    if (
      this.scenario === "unavailable" ||
      this.scenario === "timeout"
    ) {
      throw new AppError({
        code: "GMAIL_UNAVAILABLE",
        message:
          this.scenario === "timeout"
            ? "Gmail provider timed out."
            : "Gmail provider is unavailable.",
        statusCode: 503,
        retryable: true,
        fallback: "OPEN_LOOPS_ONLY",
        details: { reason: this.scenario }
      });
    }
    return [
      {
        id: "mail_contract_1",
        threadId: "thread_contract_1",
        from: "Sender <sender@example.com>",
        replyTo: "sender@example.com",
        subject: "Contract test",
        receivedAt: "2026-07-24T21:30:00+08:00",
        plainText: "This is a provider contract test."
      }
    ];
  }

  async createDraft(
    request: DraftRequest,
    options?: ProviderCallOptions
  ): Promise<DraftResult> {
    assertMailNotAborted(options, "SUMMARY_ONLY");
    if (this.scenario === "draft_failure") {
      throw new AppError({
        code: "GMAIL_DRAFT_FAILED",
        message: "Gmail draft creation failed.",
        statusCode: 503,
        retryable: true,
        fallback: "SUMMARY_ONLY"
      });
    }
    const existing = this.drafts.get(request.dedupeKey);
    if (existing) {
      return existing;
    }
    const result = { draftId: `draft-${this.drafts.size + 1}` };
    this.drafts.set(request.dedupeKey, result);
    this.draftWrites.set(
      request.dedupeKey,
      (this.draftWrites.get(request.dedupeKey) ?? 0) + 1
    );
    return result;
  }
}

function assertMailNotAborted(
  options: ProviderCallOptions | undefined,
  fallback: "OPEN_LOOPS_ONLY" | "SUMMARY_ONLY"
): void {
  if (!options?.signal?.aborted) {
    return;
  }
  throw new AppError({
    code:
      fallback === "OPEN_LOOPS_ONLY"
        ? "GMAIL_UNAVAILABLE"
        : "GMAIL_DRAFT_FAILED",
    message: "Mail provider operation was aborted.",
    statusCode: 503,
    retryable: true,
    fallback,
    details: { reason: "aborted" }
  });
}

class ContractMailHarness implements MailProviderContractHarness {
  readonly provider = new ContractMailProvider();

  setScenario(scenario: MailProviderScenario): void {
    this.provider.scenario = scenario;
  }

  createdDraftCount(dedupeKey: string): number {
    return this.provider.draftWrites.get(dedupeKey) ?? 0;
  }
}

class ContractMessagingHarness
  implements MessagingProviderContractHarness<InboundMessage>
{
  readonly ready = new RecordingMessagingChannel();
  readonly unavailable = new UnavailableMessagingChannel();
  readonly mapper = new NormalizedInboundMessageMapper();
  readonly deduplicator = new InMemoryInboundEventDeduplicator();
  channel: MessagingChannel = this.ready;

  setScenario(scenario: MessagingProviderScenario): void {
    this.channel =
      scenario === "ready" ? this.ready : this.unavailable;
  }

  sentMessages(): OutboundMessage[] {
    return this.ready.sent();
  }

  sampleInboundPayload(): InboundMessage {
    return {
      eventId: "event-contract-1",
      providerMessageId: "provider-message-contract-1",
      senderId: "sender-contract-1",
      recipientId: "recipient-contract-1",
      text: "Inbound provider contract message.",
      receivedAt: "2026-07-24T21:40:00+08:00"
    };
  }
}

defineMailProviderContractTests({
  name: "Provider Integration Kit",
  createHarness: () => new ContractMailHarness()
});

defineMessagingProviderContractTests({
  name: "Provider Integration Kit",
  createHarness: () => new ContractMessagingHarness()
});
