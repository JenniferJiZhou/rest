import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../src/domain/errors.js";
import type {
  InboundEventDeduplicator,
  InboundMessage,
  InboundMessageMapper,
  MessagingChannel,
  OutboundMessage
} from "../../src/domain/ports.js";

export type MessagingProviderScenario = "ready" | "unavailable";

export interface MessagingProviderContractHarness<Payload = unknown> {
  channel: MessagingChannel;
  mapper: InboundMessageMapper<Payload>;
  deduplicator: InboundEventDeduplicator;
  sampleInboundPayload(): Payload;
  setScenario(scenario: MessagingProviderScenario): Promise<void> | void;
  sentMessages(): Promise<OutboundMessage[]> | OutboundMessage[];
}

export interface MessagingProviderContractOptions<Payload = unknown> {
  name: string;
  createHarness(): MessagingProviderContractHarness<Payload>;
}

const sampleOutbound: OutboundMessage = {
  recipientId: "recipient-contract-1",
  text: "Provider contract test message.",
  correlationId: "correlation-contract-1"
};

export function defineMessagingProviderContractTests<Payload>(
  options: MessagingProviderContractOptions<Payload>
): void {
  describe(`${options.name} MessagingChannel contract`, () => {
    let harness: MessagingProviderContractHarness<Payload>;

    beforeEach(() => {
      harness = options.createHarness();
    });

    it("sends an outbound normalized message", async () => {
      await harness.setScenario("ready");
      await harness.channel.send(sampleOutbound);
      await expect(
        Promise.resolve(harness.sentMessages())
      ).resolves.toEqual([sampleOutbound]);
    });

    it("maps an inbound provider payload to the normalized boundary", () => {
      const message = harness.mapper.map(harness.sampleInboundPayload());
      assertInboundMessage(message);
    });

    it("maps provider unavailable to a retryable AppError", async () => {
      await harness.setScenario("unavailable");
      const error = await captureError(() =>
        harness.channel.send(sampleOutbound)
      );
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: "PHOTON_UNAVAILABLE",
        retryable: true,
        fallback: "APP_ONLY"
      });
    });

    it("claims the same inbound event ID only once", async () => {
      const message = harness.mapper.map(harness.sampleInboundPayload());
      await expect(
        harness.deduplicator.claim(message.eventId, 3600)
      ).resolves.toBe(true);
      await expect(
        harness.deduplicator.claim(message.eventId, 3600)
      ).resolves.toBe(false);
    });

    it("exposes ready health for the local Mock/Console path", async () => {
      await harness.setScenario("ready");
      await expect(harness.channel.health()).resolves.toBe("ready");
    });

    it("honors an already-aborted send signal", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        harness.channel.send(sampleOutbound, {
          signal: controller.signal
        })
      ).rejects.toMatchObject({
        details: { reason: "aborted" }
      });
    });
  });
}

function assertInboundMessage(message: InboundMessage): void {
  expect(Object.keys(message).sort()).toEqual(
    [
      "eventId",
      "providerMessageId",
      "receivedAt",
      "recipientId",
      "senderId",
      "text"
    ].sort()
  );
  expect(message.eventId).not.toHaveLength(0);
  expect(message.providerMessageId).not.toHaveLength(0);
  expect(message.senderId).not.toHaveLength(0);
  expect(message.recipientId).not.toHaveLength(0);
  expect(message.text).toEqual(expect.any(String));
  expect(Number.isNaN(Date.parse(message.receivedAt))).toBe(false);
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
