import { describe, expect, it } from "vitest";
import { InboxService } from "../../src/application/inbox/inbox-service.js";
import type {
  InboxEventBatch,
  InboxProvider,
  InboxSendResult
} from "../../src/domain/contracts.js";
import type {
  Clock,
  IdGenerator,
  ProviderCallOptions
} from "../../src/domain/ports.js";
import { InMemoryIdempotencyStore } from "../../src/infra/in-memory.js";
import { InMemoryConfirmationTokenStore } from "../../src/inbox/confirmation.js";
import {
  InMemoryCheckpointStore,
  InMemoryInboxDraftRepository,
  InMemoryInboxRepository
} from "../../src/inbox/in-memory.js";
import { FixtureInboxIntelligenceProvider } from "../../src/inbox/intelligence.js";
import type {
  InboxSendInput,
  InboxSender
} from "../../src/inbox/ports.js";

const PRINCIPAL_ID = "app-session-1";

describe("InboxService", () => {
  it("ingests once and enriches a new item", async () => {
    const { service } = fixtureService();
    const result = await service.ingest(batch("provider-message-1"));
    const duplicate = await service.ingest(batch("provider-message-1"));
    const item = await service.getItem(result.itemIds[0]!);

    expect(result).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(duplicate).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(item.summary).toBeTruthy();
    expect(item.draft_id).toBeTruthy();
  });

  it("does not overwrite a user-edited draft when AI reruns", async () => {
    const { service } = fixtureService();
    const { itemIds } = await service.ingest(
      batch("provider-message-2")
    );
    const item = await service.getItem(itemIds[0]!);
    const draft = await service.getDraft(item.draft_id!);
    const edited = await service.updateDraft(draft.id, {
      content: "用户最终文本",
      contentType: "text",
      expectedVersion: draft.version
    });

    await service.createDraft(item.id);
    expect((await service.getDraft(edited.id)).content).toBe(
      "用户最终文本"
    );
  });

  it("requires confirmation before sending", async () => {
    const { service } = fixtureService();
    const draft = await seededDraft(service);

    await expect(
      service.sendDraft(draft.id, {
        expectedVersion: draft.version,
        confirmationToken: "not-issued",
        idempotencyKey: "send-key-0001",
        principalId: PRINCIPAL_ID
      })
    ).rejects.toMatchObject({
      code: "INBOX_CONFIRMATION_REQUIRED"
    });
  });

  it("sends once after confirmation and replays the same result", async () => {
    const { service, sender } = fixtureService();
    const draft = await seededDraft(service);
    const confirmation = await service.issueConfirmation(
      draft.id,
      PRINCIPAL_ID
    );
    const request = {
      expectedVersion: draft.version,
      confirmationToken: confirmation.token,
      idempotencyKey: "send-key-0002",
      principalId: PRINCIPAL_ID
    };

    const first = await service.sendDraft(draft.id, request);
    const second = await service.sendDraft(draft.id, request);

    expect(first.status).toBe("sent");
    expect(second).toEqual(first);
    expect(sender.sendCount).toBe(1);
    expect((await service.getDraft(draft.id)).status).toBe("sent");
  });

  it("rejects reuse of an idempotency key for different content", async () => {
    const { service } = fixtureService();
    const firstDraft = await seededDraft(
      service,
      "provider-message-idempotency-1"
    );
    const firstConfirmation = await service.issueConfirmation(
      firstDraft.id,
      PRINCIPAL_ID
    );
    await service.sendDraft(firstDraft.id, {
      expectedVersion: firstDraft.version,
      confirmationToken: firstConfirmation.token,
      idempotencyKey: "send-key-shared",
      principalId: PRINCIPAL_ID
    });

    const secondDraft = await seededDraft(
      service,
      "provider-message-idempotency-2"
    );
    const secondConfirmation = await service.issueConfirmation(
      secondDraft.id,
      PRINCIPAL_ID
    );
    await expect(
      service.sendDraft(secondDraft.id, {
        expectedVersion: secondDraft.version,
        confirmationToken: secondConfirmation.token,
        idempotencyKey: "send-key-shared",
        principalId: PRINCIPAL_ID
      })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      statusCode: 409
    });
  });

  it("keeps an uncertain provider result unknown without retrying", async () => {
    const { service, sender } = fixtureService("unknown");
    const draft = await seededDraft(service);
    const confirmation = await service.issueConfirmation(
      draft.id,
      PRINCIPAL_ID
    );

    await expect(
      service.sendDraft(draft.id, {
        expectedVersion: draft.version,
        confirmationToken: confirmation.token,
        idempotencyKey: "send-key-unknown",
        principalId: PRINCIPAL_ID
      })
    ).resolves.toMatchObject({ status: "unknown" });
    expect(sender.sendCount).toBe(1);
    expect((await service.getDraft(draft.id)).status).toBe("unknown");
  });

  it("binds confirmation to the authenticated app session", async () => {
    const { service, sender } = fixtureService();
    const draft = await seededDraft(service);
    const confirmation = await service.issueConfirmation(
      draft.id,
      PRINCIPAL_ID
    );

    await expect(
      service.sendDraft(draft.id, {
        expectedVersion: draft.version,
        confirmationToken: confirmation.token,
        idempotencyKey: "send-key-wrong-session",
        principalId: "different-app-session"
      })
    ).rejects.toMatchObject({
      code: "INBOX_CONFIRMATION_REQUIRED"
    });
    expect(sender.sendCount).toBe(0);
  });

  it("rejects edits after a draft is claimed for sending", async () => {
    const { service, sender } = fixtureService();
    const draft = await seededDraft(service);
    const confirmation = await service.issueConfirmation(
      draft.id,
      PRINCIPAL_ID
    );
    sender.pause();

    const sending = service.sendDraft(draft.id, {
      expectedVersion: draft.version,
      confirmationToken: confirmation.token,
      idempotencyKey: "send-key-edit-race",
      principalId: PRINCIPAL_ID
    });
    await sender.started;

    await expect(
      service.updateDraft(draft.id, {
        content: "竞态修改",
        contentType: "text",
        expectedVersion: draft.version
      })
    ).rejects.toMatchObject({
      code: "INBOX_VERSION_CONFLICT",
      details: { current_status: "sending" }
    });
    sender.resume();
    await expect(sending).resolves.toMatchObject({ status: "sent" });
  });

  it("does not reopen sent or unknown drafts through editing", async () => {
    for (const status of ["sent", "unknown"] as const) {
      const { service } = fixtureService(status);
      const draft = await seededDraft(
        service,
        `provider-message-terminal-${status}`
      );
      const confirmation = await service.issueConfirmation(
        draft.id,
        PRINCIPAL_ID
      );
      await service.sendDraft(draft.id, {
        expectedVersion: draft.version,
        confirmationToken: confirmation.token,
        idempotencyKey: `send-key-terminal-${status}`,
        principalId: PRINCIPAL_ID
      });

      await expect(
        service.updateDraft(draft.id, {
          content: "不得重新打开",
          contentType: "text",
          expectedVersion: draft.version
        })
      ).rejects.toMatchObject({
        code: "INBOX_VERSION_CONFLICT",
        details: { current_status: status }
      });
    }
  });

  it("reports missing resources and sync status", async () => {
    const { service, checkpoints } = fixtureService();

    await expect(service.getItem("missing")).rejects.toMatchObject({
      code: "INBOX_ITEM_NOT_FOUND"
    });
    await expect(service.getDraft("missing")).rejects.toMatchObject({
      code: "INBOX_DRAFT_NOT_FOUND"
    });

    await service.ingest(batch("provider-message-status"));
    await checkpoints.put(
      "outlook",
      "hush@example.com",
      "checkpoint-1"
    );
    await expect(service.syncStatus()).resolves.toEqual([
      expect.objectContaining({
        provider: "outlook",
        account_id: "hush@example.com",
        checkpoint: "checkpoint-1",
        status: "ready"
      })
    ]);
  });
});

class FixtureSender implements InboxSender {
  readonly provider: InboxProvider = "outlook";
  readonly dataOrigin = "mock" as const;
  sendCount = 0;
  readonly started: Promise<void>;
  private resolveStarted!: () => void;
  private gate: Promise<void> | null = null;
  private resolveGate: (() => void) | null = null;

  constructor(
    private readonly resultStatus: InboxSendResult["status"]
  ) {
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
  }

  pause(): void {
    this.gate = new Promise((resolve) => {
      this.resolveGate = resolve;
    });
  }

  resume(): void {
    this.resolveGate?.();
    this.gate = null;
    this.resolveGate = null;
  }

  async health(): Promise<"ready"> {
    return "ready";
  }

  async send(
    input: InboxSendInput,
    _options?: ProviderCallOptions
  ): Promise<InboxSendResult> {
    this.sendCount += 1;
    this.resolveStarted();
    await this.gate;
    return {
      draft_id: input.draftId,
      provider: this.provider,
      status: this.resultStatus,
      provider_message_id:
        this.resultStatus === "sent" ? "sent-message-1" : null,
      sent_at:
        this.resultStatus === "sent"
          ? "2026-07-24T01:10:00.000Z"
          : null
    };
  }
}

function fixtureService(
  resultStatus: InboxSendResult["status"] = "sent"
) {
  const clock: Clock = {
    now: () => new Date("2026-07-24T01:00:00.000Z")
  };
  let id = 0;
  const ids: IdGenerator = {
    next: (prefix) => `${prefix}-${++id}`
  };
  const sender = new FixtureSender(resultStatus);
  const checkpoints = new InMemoryCheckpointStore(clock.now);
  const service = new InboxService(
    new InMemoryInboxRepository(),
    new InMemoryInboxDraftRepository(),
    new FixtureInboxIntelligenceProvider(),
    new Map([[sender.provider, sender]]),
    new InMemoryConfirmationTokenStore(clock.now),
    new InMemoryIdempotencyStore<InboxSendResult>(),
    checkpoints,
    clock,
    ids
  );
  return { service, sender, checkpoints };
}

async function seededDraft(
  service: InboxService,
  providerMessageId = "provider-message-send"
) {
  const { itemIds } = await service.ingest(batch(providerMessageId));
  const item = await service.getItem(itemIds[0]!);
  return service.getDraft(item.draft_id!);
}

function batch(providerMessageId: string): InboxEventBatch {
  return {
    schema_version: "1.0",
    request_id: `request-${providerMessageId}`,
    checkpoint: "checkpoint-1",
    events: [
      {
        provider: "outlook",
        account_id: "hush@example.com",
        conversation_id: "conversation-1",
        provider_message_id: providerMessageId,
        sender: "sender@example.com",
        recipients: ["hush@example.com"],
        subject: "项目确认",
        content: "请确认项目时间。",
        received_at: "2026-07-24T09:00:00+08:00",
        coverage: {
          source: "official_api",
          complete: true,
          note: null
        }
      }
    ]
  };
}
