import {
  inboxEventBatchSchema,
  inboxSendResultSchema,
  type InboxDraft,
  type InboxEventBatch,
  type InboxSendResult,
  type InboxSummaryResult,
  type InboxSyncStatus,
  type UnifiedInboxItem
} from "../../domain/contracts.js";
import { AppError } from "../../domain/errors.js";
import { canonicalRequestHash } from "../../domain/request-hash.js";
import type {
  Clock,
  IdGenerator,
  IdempotencyStore
} from "../../domain/ports.js";
import type {
  CheckpointStore,
  ConfirmationTokenStore,
  InboxDraftRepository,
  InboxIntelligenceProvider,
  InboxParticipantBinding,
  InboxParticipantDirectory,
  InboxRepository,
  ReplyDraftResult,
  InboxSourceMessage,
  InboxSummaryInput,
  InboxSender
} from "../../inbox/ports.js";
import type { InboxProvider } from "../../domain/contracts.js";

const SEND_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export interface InboxIngestResult {
  accepted: number;
  duplicates: number;
  itemIds: string[];
}

export interface InboxDraftUpdate {
  content: string;
  contentType: "text" | "html";
  expectedVersion: number;
}

export interface InboxDraftSend {
  expectedVersion: number;
  confirmationToken: string;
  idempotencyKey: string;
  principalId: string;
}

export class InboxService {
  constructor(
    private readonly items: InboxRepository,
    private readonly drafts: InboxDraftRepository,
    private readonly intelligence: InboxIntelligenceProvider,
    private readonly senders: ReadonlyMap<InboxProvider, InboxSender>,
    private readonly confirmations: ConfirmationTokenStore,
    private readonly sendIdempotency: IdempotencyStore<InboxSendResult>,
    private readonly checkpoints: CheckpointStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly participants?: InboxParticipantDirectory
  ) {}

  async ingest(
    input: InboxEventBatch,
    participantBindings: InboxParticipantBinding[] = []
  ): Promise<InboxIngestResult> {
    const batch = inboxEventBatchSchema.parse(input);
    const itemIds: string[] = [];
    const changedRevisions = new Map<string, number>();
    let accepted = 0;

    if (participantBindings.length > 0) {
      if (!this.participants) {
        throw new AppError({
          code: "INTERNAL_ERROR",
          message: "回复目标目录未配置。",
          statusCode: 500
        });
      }
      await this.participants.bindAll(participantBindings);
    }

    for (const event of batch.events) {
      const result = await this.items.upsert(event);
      itemIds.push(result.item.id);
      if (result.changed) {
        accepted += 1;
        changedRevisions.set(result.item.id, result.item.revision);
      }
    }

    for (const [itemId, expectedRevision] of changedRevisions) {
      await this.enrichIngestedItem(itemId, expectedRevision);
    }

    return {
      accepted,
      duplicates: batch.events.length - accepted,
      itemIds
    };
  }

  private async enrichIngestedItem(
    itemId: string,
    expectedRevision: number
  ): Promise<void> {
    const item = await this.getItem(itemId);
    const messages = await this.items.sourceMessages(itemId);
    let summary: InboxSummaryResult;
    try {
      summary = await this.intelligence.summarize(
        conversationInput(item, messages)
      );
    } catch {
      await this.markEnrichmentFailed(itemId, expectedRevision);
      return;
    }

    let enriched: UnifiedInboxItem;
    try {
      enriched = await this.items.saveEnrichment(
        itemId,
        expectedRevision,
        summary
      );
    } catch (error) {
      if (isVersionConflict(error)) {
        return;
      }
      throw error;
    }
    if (!enriched.needs_reply) {
      return;
    }

    let generated: ReplyDraftResult;
    try {
      generated = await this.intelligence.draftReply({
        ...conversationInput(enriched, messages),
        summary: enriched.summary!,
        importantPoints: enriched.important_points,
        todos: enriched.todos,
        priority: enriched.priority,
        needsReply: enriched.needs_reply,
        replyTargets: enriched.reply_targets.map((target) => ({
          displayName: target.display_name,
          reason: target.reason
        }))
      });
    } catch {
      await this.markEnrichmentFailed(itemId, expectedRevision);
      return;
    }
    const draft = await this.drafts.create({
      id: this.ids.next("draft"),
      inboxItemId: enriched.id,
      content: generated.content,
      contentType: generated.contentType,
      now: this.clock.now().toISOString()
    });
    try {
      await this.items.setDraftId(
        enriched.id,
        expectedRevision,
        draft.id
      );
    } catch (error) {
      if (!isVersionConflict(error)) {
        throw error;
      }
    }
  }

  private async markEnrichmentFailed(
    itemId: string,
    expectedRevision: number
  ): Promise<void> {
    try {
      await this.items.markEnrichmentFailed(
        itemId,
        expectedRevision,
        "ai_enrichment_failed"
      );
    } catch (error) {
      if (!isVersionConflict(error)) {
        throw error;
      }
    }
  }

  async listItems(input: {
    cursor?: string;
    limit: number;
  }): Promise<{
    items: UnifiedInboxItem[];
    nextCursor: string | null;
  }> {
    return this.items.list(input);
  }

  async getItem(id: string): Promise<UnifiedInboxItem> {
    const item = await this.items.get(id);
    if (!item) {
      throw itemNotFound();
    }
    return item;
  }

  async acknowledge(
    id: string,
    expectedRevision: number
  ): Promise<UnifiedInboxItem> {
    await this.getItem(id);
    return this.items.acknowledge(
      id,
      expectedRevision,
      this.clock.now().toISOString()
    );
  }

  async summarize(id: string): Promise<UnifiedInboxItem> {
    const item = await this.getItem(id);
    const messages = await this.items.sourceMessages(id);
    const summary = await this.intelligence.summarize(
      conversationInput(item, messages)
    );
    return this.items.saveEnrichment(id, item.revision, summary);
  }

  async createDraft(itemId: string): Promise<InboxDraft> {
    let item = await this.getItem(itemId);
    if (item.draft_id) {
      const existing = await this.drafts.get(item.draft_id);
      if (existing) {
        return existing;
      }
    }
    if (!item.summary || item.needs_reply === null) {
      item = await this.summarize(itemId);
    }

    const generated = await this.intelligence.draftReply({
      ...conversationInput(
        item,
        await this.items.sourceMessages(item.id)
      ),
      summary: item.summary!,
      importantPoints: item.important_points,
      todos: item.todos,
      priority: item.priority,
      needsReply: item.needs_reply!,
      replyTargets: item.reply_targets.map((target) => ({
        displayName: target.display_name,
        reason: target.reason
      }))
    });
    const draft = await this.drafts.create({
      id: this.ids.next("draft"),
      inboxItemId: item.id,
      content: generated.content,
      contentType: generated.contentType,
      now: this.clock.now().toISOString()
    });
    await this.items.setDraftId(item.id, item.revision, draft.id);
    return draft;
  }

  async getDraft(id: string): Promise<InboxDraft> {
    const draft = await this.drafts.get(id);
    if (!draft) {
      throw draftNotFound();
    }
    return draft;
  }

  async updateDraft(
    id: string,
    input: InboxDraftUpdate
  ): Promise<InboxDraft> {
    await this.getDraft(id);
    return this.drafts.update(id, input);
  }

  async issueConfirmation(
    draftId: string,
    principalId: string
  ): Promise<{ token: string; expiresAt: string }> {
    const draft = await this.getDraft(draftId);
    if (!["ready", "edited", "failed"].includes(draft.status)) {
      throw new AppError({
        code: "INBOX_VERSION_CONFLICT",
        message: "该草稿当前不可确认发送。",
        statusCode: 409,
        details: { current_status: draft.status }
      });
    }
    return this.confirmations.issue(
      draft.id,
      draft.version,
      principalId
    );
  }

  async sendDraft(
    draftId: string,
    input: InboxDraftSend
  ): Promise<InboxSendResult> {
    const draft = await this.getDraft(draftId);
    if (draft.version !== input.expectedVersion) {
      throw new AppError({
        code: "INBOX_VERSION_CONFLICT",
        message: "草稿版本已更新，请刷新后重新确认。",
        statusCode: 409,
        details: { current_version: draft.version }
      });
    }
    const item = await this.getItem(draft.inbox_item_id);
    const replyTo = item.sender;
    if (item.conversation_type === "direct" && replyTo === null) {
      throw rawMessageUnavailable();
    }
    const replyTargetIds = item.reply_targets.map(
      (target) => target.target_id
    );
    const requestHash = canonicalRequestHash({
      draftId: draft.id,
      version: draft.version,
      provider: item.provider,
      accountId: item.account_id,
      conversationId: item.conversation_id,
      providerMessageId: item.provider_message_id,
      replyTo,
      recipients: item.recipients,
      subject: item.subject,
      content: draft.content,
      contentType: draft.content_type,
      replyTargetIds
    });
    const claim = await this.sendIdempotency.claimOrGet({
      key: input.idempotencyKey,
      requestHash,
      ttlSeconds: SEND_IDEMPOTENCY_TTL_SECONDS,
      create: async () => {
        const mentions = await this.resolveReplyTargets(
          item,
          replyTargetIds
        );
        const confirmed = await this.confirmations.consume(
          input.confirmationToken,
          draft.id,
          draft.version,
          input.principalId
        );
        if (!confirmed) {
          throw new AppError({
            code: "INBOX_CONFIRMATION_REQUIRED",
            message: "需要有效且未使用的用户发送确认。",
            statusCode: 403
          });
        }

        const sendingDraft = await this.drafts.claimForSend(
          draft.id,
          input.expectedVersion,
          this.clock.now().toISOString()
        );

        try {
          const sender = this.senders.get(item.provider);
          if (!sender) {
            throw providerUnavailable(item.provider);
          }
          const result = inboxSendResultSchema.parse(
            await sender.send({
              draftId: draft.id,
              inboxItemId: item.id,
              accountId: item.account_id,
              conversationId: item.conversation_id,
              providerMessageId: item.provider_message_id,
              replyTo,
              recipients: item.recipients,
              subject: item.subject,
              content: sendingDraft.content,
              contentType: sendingDraft.content_type,
              idempotencyKey: input.idempotencyKey,
              mentions
            })
          );
          if (
            result.draft_id !== draft.id ||
            result.provider !== item.provider
          ) {
            throw new AppError({
              code: "INBOX_PROVIDER_UNAVAILABLE",
              message: "渠道返回了不匹配的发送结果。",
              statusCode: 503,
              retryable: false,
              details: {
                provider: item.provider,
                reason: "send_result_mismatch"
              }
            });
          }
          await this.drafts.transition(draft.id, {
            expectedStatuses: ["sending"],
            status: result.status,
            providerDraftId: result.provider_message_id,
            now: this.clock.now().toISOString()
          });
          return result;
        } catch (error) {
          await this.drafts.transition(draft.id, {
            expectedStatuses: ["sending"],
            status:
              error instanceof AppError &&
              error.code === "INBOX_SEND_UNKNOWN"
                ? "unknown"
                : "failed",
            now: this.clock.now().toISOString()
          });
          throw error;
        }
      }
    });

    if (claim.kind === "conflict_different_request") {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "该 Idempotency-Key 已用于不同的发送内容。",
        statusCode: 409,
        details: { reason: "IDEMPOTENCY_KEY_REUSED" }
      });
    }
    return claim.value;
  }

  private async resolveReplyTargets(
    item: UnifiedInboxItem,
    participantRefs: string[]
  ) {
    if (participantRefs.length === 0) {
      return [];
    }
    if (!this.participants || item.conversation_id === null) {
      throw replyTargetsChanged();
    }
    return this.participants.resolve({
      provider: item.provider,
      accountId: item.account_id,
      conversationId: item.conversation_id,
      participantRefs
    });
  }

  async syncStatus(): Promise<InboxSyncStatus[]> {
    return this.checkpoints.statuses();
  }
}

function itemNotFound(): AppError {
  return new AppError({
    code: "INBOX_ITEM_NOT_FOUND",
    message: "未找到收件箱项目。",
    statusCode: 404
  });
}

function draftNotFound(): AppError {
  return new AppError({
    code: "INBOX_DRAFT_NOT_FOUND",
    message: "未找到回复草稿。",
    statusCode: 404
  });
}

function providerUnavailable(provider: InboxProvider): AppError {
  return new AppError({
    code: "INBOX_PROVIDER_UNAVAILABLE",
    message: "消息渠道暂时不可用。",
    statusCode: 503,
    retryable: true,
    details: { provider }
  });
}

function replyTargetsChanged(): AppError {
  return new AppError({
    code: "INBOX_VERSION_CONFLICT",
    message: "回复目标已发生变化，请刷新后重试。",
    statusCode: 409
  });
}

function conversationInput(
  item: UnifiedInboxItem,
  sourceMessages: InboxSourceMessage[]
): InboxSummaryInput {
  const allowedParticipants = [];
  const seen = new Set<string>();
  for (const message of sourceMessages) {
    if (
      message.senderRef !== null &&
      message.senderDisplayName !== null &&
      !seen.has(message.senderRef)
    ) {
      seen.add(message.senderRef);
      allowedParticipants.push({
        participantRef: message.senderRef,
        displayName: message.senderDisplayName
      });
    }
  }
  return {
    conversationName: item.conversation_name,
    allowedParticipants,
    messages: sourceMessages.map((message) => ({
      participantRef: message.senderRef,
      displayName: message.senderDisplayName,
      content: message.content,
      receivedAt: message.receivedAt
    }))
  };
}

function rawMessageUnavailable(): AppError {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "该收件箱项目没有可用于摘要、草稿或发送的原始消息内容。",
    statusCode: 400
  });
}

function isVersionConflict(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.code === "INBOX_VERSION_CONFLICT"
  );
}
