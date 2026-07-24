import { describe, expect, it } from "vitest";
import { UnifiedInboxService } from "../../src/application/inbox/unified-inbox-service.js";
import type {
  Clock,
  ProviderCallOptions,
  ProviderHealth,
  UnifiedInboxProvider
} from "../../src/domain/ports.js";
import type {
  UnifiedInboxDeliveryReceipt,
  UnifiedInboxDeliveryRequest,
  UnifiedInboxSnapshot
} from "../../src/domain/unified-inbox.js";
import { CannedUnifiedInboxProvider } from "../../src/infra/unified-inbox-providers.js";
import {
  InMemoryIdempotencyStore,
  InMemoryUnifiedInboxRepository
} from "../../src/infra/in-memory.js";
import { RandomIdGenerator, SystemClock } from "../../src/infra/system.js";

describe("UnifiedInboxService", () => {
  it("lists the four canned sources in stable received-at order and filters them", async () => {
    const service = createService();

    const all = await service.listItems({}, "req_inbox_list_all");
    const filtered = await service.listItems(
      { source: "outlook", needsReply: true },
      "req_inbox_list_filtered"
    );

    expect(all.items.map((item) => item.source)).toEqual([
      "feishu",
      "dingtalk",
      "outlook",
      "qq_mail"
    ]);
    expect(
      all.items.map((item) => item.receivedAt)
    ).toEqual(
      [...all.items]
        .map((item) => item.receivedAt)
        .sort((left, right) => right.localeCompare(left))
    );
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]).toMatchObject({
      id: "item_outlook_001",
      source: "outlook",
      needsReply: true
    });
  });

  it("returns provider-neutral detail and a safe not-found error", async () => {
    const service = createService();

    await expect(
      service.getItem("item_feishu_001", "req_inbox_detail")
    ).resolves.toMatchObject({
      id: "item_feishu_001",
      source: "feishu",
      participants: [{ displayName: "Demo Teammate", address: null }],
      attachments: [],
      providerCapabilities: {
        canAcknowledge: true,
        canDraftReply: true,
        canSendReply: true
      }
    });
    await expect(
      service.getItem("missing", "req_inbox_missing")
    ).rejects.toMatchObject({
      statusCode: 404,
      details: { reason: "UNIFIED_INBOX_ITEM_NOT_FOUND" }
    });
  });

  it("acknowledges an item once and replays the same request idempotently", async () => {
    const service = createService();

    const first = await service.acknowledge(
      "item_dingtalk_001",
      "req_inbox_ack",
      "idem-inbox-ack"
    );
    const replay = await service.acknowledge(
      "item_dingtalk_001",
      "req_inbox_ack",
      "idem-inbox-ack"
    );

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      status: "acknowledged",
      isUnread: false
    });
    expect(first.acknowledgedAt).not.toBeNull();
  });

  it("updates a draft with optimistic version control", async () => {
    const service = createService();
    const initial = await service.getDraft(
      "draft_feishu_001",
      "req_draft_get"
    );

    const updated = await service.updateDraft(
      "draft_feishu_001",
      {
        schema_version: "1.0",
        request_id: "req_draft_update",
        operation: "update_body",
        expected_version: initial.version,
        body: "Thanks. I reviewed the mock checklist."
      },
      "idem-draft-update"
    );

    expect(updated).toMatchObject({
      body: "Thanks. I reviewed the mock checklist.",
      status: "editing",
      version: initial.version + 1,
      confirmationState: "invalidated"
    });
    await expect(
      service.updateDraft(
        "draft_feishu_001",
        {
          schema_version: "1.0",
          request_id: "req_draft_stale",
          operation: "update_body",
          expected_version: initial.version,
          body: "This stale edit must not win."
        },
        "idem-draft-stale"
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      details: {
        reason: "UNIFIED_INBOX_DRAFT_VERSION_CONFLICT",
        current_version: initial.version + 1
      }
    });
  });

  it("discards a draft and prevents later edits", async () => {
    const service = createService();

    const discarded = await service.updateDraft(
      "draft_qq_mail_001",
      {
        schema_version: "1.0",
        request_id: "req_draft_discard",
        operation: "discard",
        expected_version: 1
      },
      "idem-draft-discard"
    );

    expect(discarded).toMatchObject({
      status: "discarded",
      version: 2
    });
    await expect(
      service.updateDraft(
        "draft_qq_mail_001",
        {
          schema_version: "1.0",
          request_id: "req_edit_discarded",
          operation: "update_body",
          expected_version: 2,
          body: "This must remain discarded."
        },
        "idem-edit-discarded"
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      details: {
        reason: "UNIFIED_INBOX_DRAFT_STATE_CONFLICT",
        status: "discarded"
      }
    });
    await expect(
      service.createConfirmation(
        "draft_qq_mail_001",
        {
          schema_version: "1.0",
          request_id: "req_confirm_discarded",
          expected_version: 2
        },
        "idem-confirm-discarded"
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { status: "discarded" }
    });
  });

  it("creates one short-lived confirmation bound to the current draft version", async () => {
    const service = createService();
    const request = {
      schema_version: "1.0" as const,
      request_id: "req_confirmation_create",
      expected_version: 1
    };

    const first = await service.createConfirmation(
      "draft_outlook_001",
      request,
      "idem-confirmation-create"
    );
    const replay = await service.createConfirmation(
      "draft_outlook_001",
      request,
      "idem-confirmation-create"
    );

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      draftId: "draft_outlook_001",
      itemId: "item_outlook_001",
      source: "outlook",
      draftVersion: 1
    });
    expect(Date.parse(first.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("simulates one confirmed canned send and replays it without redelivery", async () => {
    const service = createService();
    const confirmation = await service.createConfirmation(
      "draft_feishu_001",
      {
        schema_version: "1.0",
        request_id: "req_send_confirmation",
        expected_version: 1
      },
      "idem-send-confirmation"
    );
    const request = {
      schema_version: "1.0" as const,
      request_id: "req_send_draft",
      confirmation_id: confirmation.confirmationId,
      expected_version: 1
    };

    const sent = await service.sendDraft(
      "draft_feishu_001",
      request,
      "idem-send-draft"
    );
    const replay = await service.sendDraft(
      "draft_feishu_001",
      request,
      "idem-send-draft"
    );

    expect(sent).toEqual(replay);
    expect(sent).toMatchObject({
      draftId: "draft_feishu_001",
      itemId: "item_feishu_001",
      status: "sent",
      deliveryMode: "simulated"
    });
    await expect(
      service.getDraft("draft_feishu_001", "req_get_sent")
    ).resolves.toMatchObject({
      status: "sent",
      confirmationState: "consumed"
    });
    await expect(
      service.updateDraft(
        "draft_feishu_001",
        {
          schema_version: "1.0",
          request_id: "req_edit_sent",
          operation: "update_body",
          expected_version: 1,
          body: "A sent draft cannot be edited."
        },
        "idem-edit-sent"
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { status: "sent" }
    });
  });

  it("invalidates an old confirmation when the draft body changes", async () => {
    const service = createService();
    const confirmation = await service.createConfirmation(
      "draft_feishu_001",
      {
        schema_version: "1.0",
        request_id: "req_stale_confirmation",
        expected_version: 1
      },
      "idem-stale-confirmation"
    );
    await service.updateDraft(
      "draft_feishu_001",
      {
        schema_version: "1.0",
        request_id: "req_edit_after_confirmation",
        operation: "update_body",
        expected_version: 1,
        body: "The body changed after confirmation."
      },
      "idem-edit-after-confirmation"
    );

    await expect(
      service.sendDraft(
        "draft_feishu_001",
        {
          schema_version: "1.0",
          request_id: "req_send_stale_confirmation",
          confirmation_id: confirmation.confirmationId,
          expected_version: 2
        },
        "idem-send-stale-confirmation"
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: "UNIFIED_INBOX_CONFIRMATION_MISSING" }
    });
  });

  it("rejects expired and cross-draft confirmations", async () => {
    const clock = new MutableClock("2026-07-24T04:00:00.000Z");
    const service = createService({ clock });
    const feishu = await service.createConfirmation(
      "draft_feishu_001",
      {
        schema_version: "1.0",
        request_id: "req_confirm_feishu",
        expected_version: 1
      },
      "idem-confirm-feishu"
    );
    await service.createConfirmation(
      "draft_outlook_001",
      {
        schema_version: "1.0",
        request_id: "req_confirm_outlook",
        expected_version: 1
      },
      "idem-confirm-outlook"
    );

    await expect(
      service.sendDraft(
        "draft_outlook_001",
        {
          schema_version: "1.0",
          request_id: "req_cross_draft",
          confirmation_id: feishu.confirmationId,
          expected_version: 1
        },
        "idem-cross-draft"
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: "UNIFIED_INBOX_CONFIRMATION_MISMATCH" }
    });

    clock.advance(5 * 60_000 + 1);
    await expect(
      service.sendDraft(
        "draft_feishu_001",
        {
          schema_version: "1.0",
          request_id: "req_expired_confirmation",
          confirmation_id: feishu.confirmationId,
          expected_version: 1
        },
        "idem-expired-confirmation"
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: "UNIFIED_INBOX_CONFIRMATION_EXPIRED" }
    });
  });

  it("restores confirmed state after Provider failure and never marks sent", async () => {
    const service = createService({
      provider: new FailingSendProvider()
    });
    const confirmation = await service.createConfirmation(
      "draft_feishu_001",
      {
        schema_version: "1.0",
        request_id: "req_failure_confirmation",
        expected_version: 1
      },
      "idem-failure-confirmation"
    );

    await expect(
      service.sendDraft(
        "draft_feishu_001",
        {
          schema_version: "1.0",
          request_id: "req_provider_failure",
          confirmation_id: confirmation.confirmationId,
          expected_version: 1
        },
        "idem-provider-failure"
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      retryable: true,
      details: { reason: "UNIFIED_INBOX_DELIVERY_FAILED" }
    });
    await expect(
      service.getDraft("draft_feishu_001", "req_after_failure")
    ).resolves.toMatchObject({
      status: "confirmed",
      sentAt: null
    });
  });

  it("allows at most one concurrent send claim", async () => {
    const provider = new ControlledSendProvider();
    const service = createService({ provider });
    const confirmation = await service.createConfirmation(
      "draft_feishu_001",
      {
        schema_version: "1.0",
        request_id: "req_concurrent_confirmation",
        expected_version: 1
      },
      "idem-concurrent-confirmation"
    );
    const first = service.sendDraft(
      "draft_feishu_001",
      {
        schema_version: "1.0",
        request_id: "req_concurrent_first",
        confirmation_id: confirmation.confirmationId,
        expected_version: 1
      },
      "idem-concurrent-first"
    );
    await provider.started;

    await expect(
      service.sendDraft(
        "draft_feishu_001",
        {
          schema_version: "1.0",
          request_id: "req_concurrent_second",
          confirmation_id: confirmation.confirmationId,
          expected_version: 1
        },
        "idem-concurrent-second"
      )
    ).rejects.toMatchObject({
      statusCode: 409,
      details: {
        reason: "UNIFIED_INBOX_DRAFT_STATE_CONFLICT",
        status: "sending"
      }
    });
    provider.release();
    await expect(first).resolves.toMatchObject({
      status: "sent",
      deliveryMode: "simulated"
    });
    expect(provider.deliveryCalls).toBe(1);
  });
});

function createService(
  options: {
    provider?: UnifiedInboxProvider;
    clock?: Clock;
  } = {}
): UnifiedInboxService {
  return new UnifiedInboxService(
    options.provider ?? new CannedUnifiedInboxProvider(),
    new InMemoryUnifiedInboxRepository(),
    new InMemoryIdempotencyStore(),
    options.clock ?? new SystemClock(),
    new RandomIdGenerator()
  );
}

class MutableClock implements Clock {
  private value: Date;

  constructor(iso: string) {
    this.value = new Date(iso);
  }

  now(): Date {
    return new Date(this.value);
  }

  advance(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }
}

class FailingSendProvider implements UnifiedInboxProvider {
  readonly dataOrigin = "mock" as const;
  private readonly canned = new CannedUnifiedInboxProvider();

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async loadSnapshot(
    options?: ProviderCallOptions
  ): Promise<UnifiedInboxSnapshot> {
    return this.canned.loadSnapshot(options);
  }

  async deliver(
    _request: UnifiedInboxDeliveryRequest,
    _options?: ProviderCallOptions
  ): Promise<UnifiedInboxDeliveryReceipt> {
    throw new Error("raw Provider secret must not escape");
  }
}

class ControlledSendProvider implements UnifiedInboxProvider {
  readonly dataOrigin = "mock" as const;
  private readonly canned = new CannedUnifiedInboxProvider();
  private readonly startedGate = deferred<void>();
  private readonly releaseGate = deferred<void>();
  deliveryCalls = 0;

  get started(): Promise<void> {
    return this.startedGate.promise;
  }

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async loadSnapshot(
    options?: ProviderCallOptions
  ): Promise<UnifiedInboxSnapshot> {
    return this.canned.loadSnapshot(options);
  }

  async deliver(): Promise<UnifiedInboxDeliveryReceipt> {
    this.deliveryCalls += 1;
    this.startedGate.resolve();
    await this.releaseGate.promise;
    return { deliveryMode: "simulated" };
  }

  release(): void {
    this.releaseGate.resolve();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
