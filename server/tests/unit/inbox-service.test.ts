import { describe, expect, it } from "vitest";
import { InboxService } from "../../src/application/inbox/inbox-service.js";
import type {
  InboxEventBatch,
  InboxProvider,
  InboxSendResult,
  InboxSummaryResult,
  UnifiedInboxItem
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
  InMemoryInboxParticipantDirectory,
  InMemoryInboxRepository
} from "../../src/inbox/in-memory.js";
import { FixtureInboxIntelligenceProvider } from "../../src/inbox/intelligence.js";
import type {
  InboxDraftRepository,
  InboxIntelligenceProvider,
  InboxParticipantDirectory,
  InboxRepository,
  InboxSendInput,
  InboxSender,
  InboxSummaryInput,
  ReplyDraftInput,
  ReplyDraftResult
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

  it("summarizes a group digest from its safe source messages", async () => {
    const { service } = fixtureService();
    const result = await service.ingest(groupBatch());
    const item = await service.getItem(result.itemIds[0]!);

    expect(item).toMatchObject({
      conversation_type: "group",
      item_kind: "conversation_digest",
      sender: null,
      content: null,
      summary: expect.stringContaining("项目讨论组"),
      reply_targets: [
        expect.objectContaining({
          target_id: "participant_demo_0001",
          display_name: "王同学"
        })
      ]
    });
  });

  it("enriches one changed group digest once for a multi-message batch", async () => {
    const intelligence = new RecordingIntelligence();
    const { service } = fixtureService("sent", { intelligence });

    const result = await service.ingest(
      groupBatch([
        "provider-group-message-batch-1",
        "provider-group-message-batch-2",
        "provider-group-message-batch-3"
      ])
    );

    expect(result).toMatchObject({ accepted: 3, duplicates: 0 });
    expect(new Set(result.itemIds).size).toBe(1);
    expect(intelligence.summaryInputs).toHaveLength(1);
    expect(intelligence.summaryInputs[0]?.messages).toHaveLength(3);
  });

  it("does not enrich a duplicate-only batch", async () => {
    const intelligence = new RecordingIntelligence();
    const { service } = fixtureService("sent", { intelligence });
    const input = groupBatch([
      "provider-group-message-duplicate-1",
      "provider-group-message-duplicate-2"
    ]);

    await service.ingest(input);
    const duplicate = await service.ingest(input);

    expect(duplicate).toMatchObject({ accepted: 0, duplicates: 2 });
    expect(intelligence.summaryInputs).toHaveLength(1);
  });

  it("does not generate a draft when enrichment says no reply is needed", async () => {
    const intelligence = new RecordingIntelligence({
      needs_reply: false,
      reply_targets: []
    });
    const { service } = fixtureService("sent", { intelligence });

    const { itemIds } = await service.ingest(
      batch("provider-message-no-reply")
    );
    const item = await service.getItem(itemIds[0]!);

    expect(item.needs_reply).toBe(false);
    expect(item.draft_id).toBeNull();
    expect(intelligence.draftInputs).toHaveLength(0);
  });

  it("marks AI enrichment failures with a sanitized reason and keeps the raw item", async () => {
    const intelligence = new RecordingIntelligence();
    intelligence.summarizeError = new Error(
      "secret provider response body"
    );
    const items = new RecordingInboxRepository();
    const { service } = fixtureService("sent", {
      intelligence,
      items
    });

    const { itemIds } = await service.ingest(
      batch("provider-message-ai-failure")
    );
    const item = await service.getItem(itemIds[0]!);

    expect(item.content).toBe("请确认项目时间。");
    expect(item.sync_status).toBe("failed");
    expect(items.enrichmentFailures).toEqual([
      {
        id: item.id,
        expectedRevision: item.revision,
        reason: "ai_enrichment_failed"
      }
    ]);
    expect(JSON.stringify(items.enrichmentFailures)).not.toContain(
      "secret provider response body"
    );
  });

  it("does not attach a late summary to a newer group revision", async () => {
    const intelligence = new RecordingIntelligence({
      needs_reply: false
    });
    const staleSummary = deferred<InboxSummaryResult>();
    intelligence.summaryResponses.push(
      staleSummary.promise,
      Promise.resolve(
        summaryResult("current revision summary", false)
      )
    );
    const { service } = fixtureService("sent", { intelligence });

    const firstIngest = service.ingest(
      groupBatch(["provider-group-summary-race-1"])
    );
    await expect
      .poll(() => intelligence.summaryInputs.length)
      .toBe(1);

    const second = await service.ingest(
      groupBatch(["provider-group-summary-race-2"])
    );
    staleSummary.resolve(summaryResult("stale summary", false));
    await firstIngest;

    const item = await service.getItem(second.itemIds[0]!);
    expect(item).toMatchObject({
      revision: 2,
      summary: "current revision summary",
      sync_status: "ready"
    });
  });

  it("does not mark a newer revision failed when an older summary rejects", async () => {
    const intelligence = new RecordingIntelligence({
      needs_reply: false
    });
    const staleSummary = deferred<InboxSummaryResult>();
    intelligence.summaryResponses.push(
      staleSummary.promise,
      Promise.resolve(
        summaryResult("healthy current revision", false)
      )
    );
    const { service } = fixtureService("sent", { intelligence });

    const firstIngest = service.ingest(
      groupBatch(["provider-group-summary-failure-race-1"])
    );
    await expect
      .poll(() => intelligence.summaryInputs.length)
      .toBe(1);

    const second = await service.ingest(
      groupBatch(["provider-group-summary-failure-race-2"])
    );
    staleSummary.reject(new Error("secret stale provider failure"));
    await firstIngest;

    const item = await service.getItem(second.itemIds[0]!);
    expect(item).toMatchObject({
      revision: 2,
      summary: "healthy current revision",
      sync_status: "ready"
    });
  });

  it("does not attach a late draft over a newer user-edited draft", async () => {
    const intelligence = new RecordingIntelligence();
    const staleDraft = deferred<ReplyDraftResult>();
    intelligence.draftResponses.push(
      staleDraft.promise,
      Promise.resolve({
        content: "current AI draft",
        contentType: "text"
      })
    );
    const { service } = fixtureService("sent", { intelligence });

    const firstIngest = service.ingest(
      groupBatch(["provider-group-draft-race-1"])
    );
    await expect
      .poll(() => intelligence.draftInputs.length)
      .toBe(1);

    const second = await service.ingest(
      groupBatch(["provider-group-draft-race-2"])
    );
    const currentItem = await service.getItem(second.itemIds[0]!);
    const currentDraft = await service.getDraft(currentItem.draft_id!);
    const edited = await service.updateDraft(currentDraft.id, {
      content: "user edited current draft",
      contentType: "text",
      expectedVersion: currentDraft.version
    });

    staleDraft.resolve({
      content: "stale AI draft",
      contentType: "text"
    });
    await firstIngest;

    const finalItem = await service.getItem(currentItem.id);
    expect(finalItem.draft_id).toBe(edited.id);
    expect(await service.getDraft(edited.id)).toMatchObject({
      content: "user edited current draft",
      origin: "user",
      status: "edited"
    });
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

  it("acknowledges only the exact current digest revision", async () => {
    const { service } = fixtureService();
    const { itemIds } = await service.ingest(
      groupBatch(["provider-group-ack-1"])
    );
    const item = await service.getItem(itemIds[0]!);

    const acknowledged = await service.acknowledge(
      item.id,
      item.revision
    );

    expect(acknowledged).toMatchObject({
      revision: item.revision,
      acknowledged_at: "2026-07-24T01:00:00.000Z",
      sealed_at: "2026-07-24T01:00:00.000Z"
    });
    await expect(
      service.acknowledge(item.id, item.revision)
    ).rejects.toMatchObject({
      code: "INBOX_VERSION_CONFLICT",
      statusCode: 409
    });
  });

  it("resolves only validated group reply targets for the sender", async () => {
    const target = {
      target_id: "participant_12345678",
      display_name: "王同学",
      reason: "需要确认接口时间"
    };
    const intelligence = new RecordingIntelligence({
      reply_targets: [target]
    });
    const sender = new FixtureSender("sent", "dingtalk");
    const { service } = fixtureService("sent", {
      intelligence,
      sender
    });
    const input = groupBatch(["provider-group-send-target-1"]);
    const { itemIds } = await service.ingest(input, [
      participantBinding(
        target.target_id,
        "ou_private_value",
        target.display_name
      )
    ]);
    const item = await service.getItem(itemIds[0]!);
    const draft = await service.getDraft(item.draft_id!);
    const confirmation = await service.issueConfirmation(
      draft.id,
      PRINCIPAL_ID
    );

    await service.sendDraft(draft.id, {
      expectedVersion: draft.version,
      confirmationToken: confirmation.token,
      idempotencyKey: "send-key-group-targets",
      principalId: PRINCIPAL_ID
    });

    expect(sender.inputs[0]?.mentions).toEqual([
      {
        participantRef: "participant_12345678",
        providerParticipantId: "ou_private_value",
        displayName: "王同学"
      }
    ]);
  });

  it("rejects a cross-scope target before confirmation consumption or draft claim", async () => {
    const target = {
      target_id: "participant_12345678",
      display_name: "王同学",
      reason: "需要确认接口时间"
    };
    const intelligence = new RecordingIntelligence({
      reply_targets: [target]
    });
    const sender = new FixtureSender("sent", "dingtalk");
    const { service } = fixtureService("sent", {
      intelligence,
      sender
    });
    const input = groupBatch(["provider-group-send-scope-1"]);
    const wrongScope = participantBinding(
      target.target_id,
      "ou_wrong_scope",
      target.display_name
    );
    wrongScope.conversationId = "different-conversation";
    const { itemIds } = await service.ingest(input, [wrongScope]);
    const item = await service.getItem(itemIds[0]!);
    const draft = await service.getDraft(item.draft_id!);
    const confirmation = await service.issueConfirmation(
      draft.id,
      PRINCIPAL_ID
    );

    await expect(
      service.sendDraft(draft.id, {
        expectedVersion: draft.version,
        confirmationToken: confirmation.token,
        idempotencyKey: "send-key-cross-scope",
        principalId: PRINCIPAL_ID
      })
    ).rejects.toMatchObject({
      code: "INBOX_VERSION_CONFLICT",
      statusCode: 409
    });
    expect(await service.getDraft(draft.id)).toMatchObject({
      status: "ready"
    });
    expect(sender.sendCount).toBe(0);

    await service.ingest(input, [
      participantBinding(
        target.target_id,
        "ou_private_value",
        target.display_name
      )
    ]);
    await expect(
      service.sendDraft(draft.id, {
        expectedVersion: draft.version,
        confirmationToken: confirmation.token,
        idempotencyKey: "send-key-cross-scope-retry",
        principalId: PRINCIPAL_ID
      })
    ).resolves.toMatchObject({ status: "sent" });
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
    expect(sender.inputs[0]?.mentions).toEqual([]);
    expect((await service.getDraft(draft.id)).status).toBe("sent");
  });

  it("includes reply target IDs in the send idempotency hash", async () => {
    const targetA = {
      target_id: "participant_12345678",
      display_name: "王同学",
      reason: "需要确认接口时间"
    };
    const targetB = {
      target_id: "participant_87654321",
      display_name: "李同学",
      reason: "需要确认测试时间"
    };
    const intelligence = new RecordingIntelligence();
    intelligence.summaryResponses.push(
      Promise.resolve({
        ...DEFAULT_SUMMARY,
        reply_targets: [targetA]
      }),
      Promise.resolve({
        ...DEFAULT_SUMMARY,
        reply_targets: [targetB]
      })
    );
    const sender = new FixtureSender("sent", "dingtalk");
    const { service } = fixtureService("sent", {
      intelligence,
      sender
    });
    const firstBatch = groupBatch(["provider-group-hash-current"]);
    const { itemIds } = await service.ingest(firstBatch, [
      participantBinding(
        targetA.target_id,
        "ou_private_a",
        targetA.display_name
      )
    ]);
    const item = await service.getItem(itemIds[0]!);
    const draft = await service.getDraft(item.draft_id!);
    const confirmation = await service.issueConfirmation(
      draft.id,
      PRINCIPAL_ID
    );
    const request = {
      expectedVersion: draft.version,
      confirmationToken: confirmation.token,
      idempotencyKey: "send-key-target-hash",
      principalId: PRINCIPAL_ID
    };
    await service.sendDraft(draft.id, request);

    const appended = groupBatch(["provider-group-hash-earlier"]);
    appended.events[0]!.received_at =
      "2026-07-24T08:00:00+08:00";
    await service.ingest(appended, [
      participantBinding(
        targetB.target_id,
        "ou_private_b",
        targetB.display_name
      )
    ]);

    await expect(
      service.sendDraft(draft.id, request)
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      statusCode: 409,
      details: { reason: "IDEMPOTENCY_KEY_REUSED" }
    });
    expect(sender.sendCount).toBe(1);
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
  readonly provider: InboxProvider;
  readonly dataOrigin = "mock" as const;
  sendCount = 0;
  readonly inputs: InboxSendInput[] = [];
  readonly started: Promise<void>;
  private resolveStarted!: () => void;
  private gate: Promise<void> | null = null;
  private resolveGate: (() => void) | null = null;

  constructor(
    private readonly resultStatus: InboxSendResult["status"],
    provider: InboxProvider = "outlook"
  ) {
    this.provider = provider;
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
    this.inputs.push(structuredClone(input));
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
  resultStatus: InboxSendResult["status"] = "sent",
  overrides: {
    items?: InboxRepository;
    drafts?: InboxDraftRepository;
    intelligence?: InboxIntelligenceProvider;
    participants?: InboxParticipantDirectory;
    sender?: FixtureSender;
  } = {}
) {
  const clock: Clock = {
    now: () => new Date("2026-07-24T01:00:00.000Z")
  };
  let id = 0;
  const ids: IdGenerator = {
    next: (prefix) => `${prefix}-${++id}`
  };
  const sender = overrides.sender ?? new FixtureSender(resultStatus);
  const checkpoints = new InMemoryCheckpointStore(clock.now);
  const participants =
    overrides.participants ?? new InMemoryInboxParticipantDirectory();
  const service = new InboxService(
    overrides.items ?? new InMemoryInboxRepository(),
    overrides.drafts ?? new InMemoryInboxDraftRepository(),
    overrides.intelligence ?? new FixtureInboxIntelligenceProvider(),
    new Map([[sender.provider, sender]]),
    new InMemoryConfirmationTokenStore(clock.now),
    new InMemoryIdempotencyStore<InboxSendResult>(),
    checkpoints,
    clock,
    ids,
    participants
  );
  return { service, sender, checkpoints, participants };
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
        conversation_type: "direct",
        conversation_name: "项目会话",
        provider_message_id: providerMessageId,
        sender: "sender@example.com",
        sender_ref: null,
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

function groupBatch(
  providerMessageIds = ["provider-group-message-1"]
): InboxEventBatch {
  return {
    schema_version: "1.0",
    request_id: "request-group-summary",
    checkpoint: "checkpoint-group-1",
    events: providerMessageIds.map((providerMessageId, index) => ({
        provider: "dingtalk",
        account_id: "hush-group-account",
        conversation_id: "conversation-group-1",
        conversation_type: "group",
        conversation_name: "项目讨论组",
        provider_message_id: providerMessageId,
        sender: "王同学",
        sender_ref: "participant_demo_0001",
        recipients: ["hush-group-account"],
        subject: null,
        content: "请王同学确认接口交付时间。",
        received_at: `2026-07-24T09:0${index}:00+08:00`,
        coverage: {
          source: "official_api",
          complete: true,
          note: null
        }
      }))
  };
}

const DEFAULT_SUMMARY: InboxSummaryResult = {
  summary: "项目会话摘要",
  important_points: ["项目待确认"],
  todos: ["确认项目时间"],
  priority: "normal",
  needs_reply: true,
  reply_targets: []
};

class RecordingIntelligence implements InboxIntelligenceProvider {
  readonly dataOrigin = "mock" as const;
  readonly summaryInputs: InboxSummaryInput[] = [];
  readonly draftInputs: ReplyDraftInput[] = [];
  readonly summaryResponses: Array<Promise<InboxSummaryResult>> = [];
  readonly draftResponses: Array<Promise<ReplyDraftResult>> = [];
  summarizeError: Error | null = null;
  private readonly summary: InboxSummaryResult;
  private readonly draft: ReplyDraftResult;

  constructor(
    summary: Partial<InboxSummaryResult> = {},
    draft: ReplyDraftResult = {
      content: "AI 草稿",
      contentType: "text"
    }
  ) {
    this.summary = { ...DEFAULT_SUMMARY, ...summary };
    this.draft = draft;
  }

  async health(): Promise<"ready"> {
    return "ready";
  }

  async summarize(input: InboxSummaryInput): Promise<InboxSummaryResult> {
    this.summaryInputs.push(structuredClone(input));
    if (this.summarizeError) {
      throw this.summarizeError;
    }
    const queued = this.summaryResponses.shift();
    if (queued) {
      return structuredClone(await queued);
    }
    return structuredClone(this.summary);
  }

  async draftReply(input: ReplyDraftInput): Promise<ReplyDraftResult> {
    this.draftInputs.push(structuredClone(input));
    const queued = this.draftResponses.shift();
    if (queued) {
      return structuredClone(await queued);
    }
    return structuredClone(this.draft);
  }
}

class RecordingInboxRepository extends InMemoryInboxRepository {
  readonly enrichmentFailures: Array<{
    id: string;
    expectedRevision: number;
    reason: string;
  }> = [];

  async markEnrichmentFailed(
    id: string,
    expectedRevision: number,
    reason: string
  ): Promise<UnifiedInboxItem> {
    this.enrichmentFailures.push({ id, expectedRevision, reason });
    return super.markEnrichmentFailed(id, expectedRevision, reason);
  }
}

function summaryResult(
  summary: string,
  needsReply: boolean
): InboxSummaryResult {
  return {
    ...DEFAULT_SUMMARY,
    summary,
    needs_reply: needsReply,
    reply_targets: []
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function participantBinding(
  participantRef: string,
  providerParticipantId: string,
  displayName: string
) {
  return {
    provider: "dingtalk" as const,
    accountId: "hush-group-account",
    conversationId: "conversation-group-1",
    participantRef,
    providerParticipantId,
    displayName
  };
}
