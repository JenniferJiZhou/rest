import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/domain/errors.js";
import type {
  InboundMessage,
  MessagingChannel,
  OutboundMessage
} from "../../src/domain/ports.js";
import { InMemoryInboundEventDeduplicator } from "../../src/infra/in-memory.js";
import {
  HmacWebhookSignatureVerifier,
  HttpMessagingChannel,
  MessagingWebhookMapper,
  type MessagingFetch,
  type MessagingWebhookPayload
} from "../../src/messaging/index.js";
import {
  defineMessagingProviderContractTests,
  type MessagingProviderContractHarness,
  type MessagingProviderScenario
} from "../provider-contracts/messaging-channel.contract.js";

const inbound: MessagingWebhookPayload = {
  event_id: "evt-1",
  message_id: "msg-1",
  sender_id: "sender-1",
  recipient_id: "hush-line",
  text: "我准备睡了",
  received_at: "2026-07-23T21:00:00+08:00"
};

class W2MessagingHarness
  implements MessagingProviderContractHarness<MessagingWebhookPayload>
{
  readonly mapper = new MessagingWebhookMapper();
  readonly deduplicator = new InMemoryInboundEventDeduplicator();
  private scenario: MessagingProviderScenario = "ready";
  private readonly messages: OutboundMessage[] = [];
  readonly channel: MessagingChannel = {
    health: async () =>
      this.scenario === "ready" ? "ready" : "unavailable",
    send: async (message, options) => {
      if (options?.signal?.aborted) {
        throw new AppError({
          code: "PHOTON_UNAVAILABLE",
          message: "消息发送已取消。",
          statusCode: 503,
          retryable: true,
          fallback: "APP_ONLY",
          details: { reason: "aborted" }
        });
      }
      if (this.scenario === "unavailable") {
        throw new AppError({
          code: "PHOTON_UNAVAILABLE",
          message: "消息渠道暂时不可用。",
          statusCode: 503,
          retryable: true,
          fallback: "APP_ONLY"
        });
      }
      this.messages.push(structuredClone(message));
    }
  };

  sampleInboundPayload(): MessagingWebhookPayload {
    return structuredClone(inbound);
  }

  setScenario(scenario: MessagingProviderScenario): void {
    this.scenario = scenario;
  }

  sentMessages(): OutboundMessage[] {
    return structuredClone(this.messages);
  }
}

defineMessagingProviderContractTests({
  name: "W2 provider-neutral relay",
  createHarness: () => new W2MessagingHarness()
});

describe("HttpMessagingChannel", () => {
  it("uses correlation ID as the provider idempotency key", async () => {
    const request = vi.fn<MessagingFetch>().mockResolvedValue(
      new Response(null, { status: 202 })
    );
    const channel = new HttpMessagingChannel(
      {
        endpoint: "https://relay.invalid/messages",
        authorizationToken: "secret",
        lineId: "hush"
      },
      request
    );

    await channel.send({
      recipientId: "recipient-1",
      text: "private text",
      correlationId: "handoff:job-1:completed"
    });

    const init = request.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      "idempotency-key": "handoff:job-1:completed"
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient_id: "recipient-1",
      text: "private text",
      correlation_id: "handoff:job-1:completed",
      line_id: "hush"
    });
  });

  it("does not call the relay when already aborted", async () => {
    const request = vi.fn<MessagingFetch>();
    const channel = new HttpMessagingChannel(
      {
        endpoint: "https://relay.invalid/messages",
        authorizationToken: "secret"
      },
      request
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      channel.send(
        {
          recipientId: "recipient-1",
          text: "private text",
          correlationId: "message-1"
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({
      code: "PHOTON_UNAVAILABLE",
      retryable: true,
      fallback: "APP_ONLY"
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("inbound webhook boundary", () => {
  it("verifies HMAC before mapping a normalized message", () => {
    const rawBody = JSON.stringify(inbound);
    const signature = createHmac("sha256", "webhook-secret")
      .update(rawBody)
      .digest("hex");
    const verifier = new HmacWebhookSignatureVerifier("webhook-secret");
    verifier.verify(rawBody, `sha256=${signature}`);

    const message: InboundMessage =
      new MessagingWebhookMapper().map(inbound);
    expect(message).toEqual({
      eventId: "evt-1",
      providerMessageId: "msg-1",
      senderId: "sender-1",
      recipientId: "hush-line",
      text: "我准备睡了",
      receivedAt: "2026-07-23T21:00:00+08:00"
    });
  });

  it("rejects an invalid signature without leaking secret details", () => {
    const verifier = new HmacWebhookSignatureVerifier("webhook-secret");
    expect(() => verifier.verify(JSON.stringify(inbound), "invalid"))
      .toThrowError(
        expect.objectContaining({
          code: "PHOTON_SIGNATURE_INVALID",
          details: null
        })
      );
  });

});
