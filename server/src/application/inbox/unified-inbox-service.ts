import { AppError } from "../../domain/errors.js";
import { canonicalRequestHash } from "../../domain/request-hash.js";
import type {
  Clock,
  DataOrigin,
  IdGenerator,
  IdempotencyStore,
  ProviderCallOptions,
  UnifiedInboxProvider,
  UnifiedInboxRepository
} from "../../domain/ports.js";
import type {
  UnifiedInboxConfirmation,
  UnifiedInboxConfirmationRequest,
  UnifiedInboxDraft,
  UnifiedInboxItemDetail,
  UnifiedInboxListFilter,
  UnifiedInboxListPage,
  UnifiedInboxPatchDraftRequest,
  UnifiedInboxSendRequest,
  UnifiedInboxSendResult
} from "../../domain/unified-inbox.js";

const IDEMPOTENCY_TTL_SECONDS = 60 * 60;
const DEFAULT_PAGE_SIZE = 50;

export class UnifiedInboxService {
  private initialization: Promise<void> | undefined;

  constructor(
    private readonly provider: UnifiedInboxProvider,
    private readonly repository: UnifiedInboxRepository,
    private readonly idempotency: IdempotencyStore<unknown>,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}

  get dataOrigin(): DataOrigin {
    return this.provider.dataOrigin;
  }

  async listItems(
    filter: UnifiedInboxListFilter,
    _requestId: string
  ): Promise<UnifiedInboxListPage> {
    await this.ensureReady();
    const offset = filter.cursor === undefined ? 0 : Number(filter.cursor);
    return this.repository.list(filter, offset, DEFAULT_PAGE_SIZE);
  }

  async getItem(
    itemId: string,
    _requestId: string
  ): Promise<UnifiedInboxItemDetail> {
    await this.ensureReady();
    const item = await this.repository.getItem(itemId);
    if (!item) {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "Unified Inbox item 不存在。",
        statusCode: 404,
        retryable: false,
        details: { reason: "UNIFIED_INBOX_ITEM_NOT_FOUND" }
      });
    }
    return item;
  }

  async acknowledge(
    itemId: string,
    requestId: string,
    idempotencyKey: string
  ): Promise<UnifiedInboxItemDetail> {
    await this.ensureReady();
    return this.idempotentMutation(
      "acknowledge",
      requestId,
      idempotencyKey,
      { itemId },
      async () => {
        const item = await this.repository.acknowledge(
          itemId,
          this.clock.now().toISOString()
        );
        if (!item) {
          throw new AppError({
            code: "INVALID_REQUEST",
            message: "Unified Inbox item 不存在。",
            statusCode: 404,
            retryable: false,
            details: { reason: "UNIFIED_INBOX_ITEM_NOT_FOUND" }
          });
        }
        return item;
      }
    );
  }

  async getDraft(
    draftId: string,
    _requestId: string
  ): Promise<UnifiedInboxDraft> {
    await this.ensureReady();
    const draft = await this.repository.getDraft(draftId);
    if (!draft) {
      throw draftNotFound();
    }
    return draft;
  }

  async updateDraft(
    draftId: string,
    request: UnifiedInboxPatchDraftRequest,
    idempotencyKey: string
  ): Promise<UnifiedInboxDraft> {
    await this.ensureReady();
    return this.idempotentMutation(
      "update-draft",
      request.request_id,
      idempotencyKey,
      { draftId, ...request },
      async () => {
        const result = await this.repository.updateDraft({
          id: draftId,
          expectedVersion: request.expected_version,
          ...(request.operation === "update_body"
            ? { body: request.body }
            : {}),
          discard: request.operation === "discard",
          updatedAt: this.clock.now().toISOString()
        });
        if (result.kind === "not_found") {
          throw draftNotFound();
        }
        if (result.kind === "version_conflict") {
          throw draftVersionConflict(result.draft.version);
        }
        if (result.kind === "invalid_state") {
          throw draftStateConflict(result.draft.status);
        }
        return result.draft;
      }
    );
  }

  async createConfirmation(
    draftId: string,
    request: UnifiedInboxConfirmationRequest,
    idempotencyKey: string
  ): Promise<UnifiedInboxConfirmation> {
    await this.ensureReady();
    return this.idempotentMutation(
      "create-confirmation",
      request.request_id,
      idempotencyKey,
      { draftId, ...request },
      async () => {
        const draft = await this.repository.getDraft(draftId);
        if (!draft) {
          throw draftNotFound();
        }
        const item = await this.repository.getItem(draft.itemId);
        if (!item) {
          throw new AppError({
            code: "INTERNAL_ERROR",
            message: "Unified Inbox item 引用不可用。",
            statusCode: 503,
            retryable: true,
            details: { reason: "UNIFIED_INBOX_ITEM_REFERENCE_MISSING" }
          });
        }
        const now = this.clock.now();
        const confirmation: UnifiedInboxConfirmation = {
          confirmationId: this.ids.next("confirmation"),
          draftId,
          itemId: item.id,
          source: item.source,
          draftVersion: request.expected_version,
          expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString()
        };
        const result = await this.repository.createConfirmation({
          draftId,
          expectedVersion: request.expected_version,
          confirmation
        });
        if (result.kind === "not_found") {
          throw draftNotFound();
        }
        if (result.kind === "version_conflict") {
          throw draftVersionConflict(result.draft.version);
        }
        if (result.kind === "invalid_state") {
          throw draftStateConflict(result.draft.status);
        }
        return result.confirmation;
      }
    );
  }

  async sendDraft(
    draftId: string,
    request: UnifiedInboxSendRequest,
    idempotencyKey: string,
    options?: ProviderCallOptions
  ): Promise<UnifiedInboxSendResult> {
    await this.ensureReady();
    return this.idempotentMutation(
      "send-draft",
      request.request_id,
      idempotencyKey,
      { draftId, ...request },
      async () => {
        const claimed = await this.repository.claimSend({
          draftId,
          expectedVersion: request.expected_version,
          confirmationId: request.confirmation_id,
          now: this.clock.now().toISOString()
        });
        if (claimed.kind === "not_found") {
          throw draftNotFound();
        }
        if (claimed.kind === "version_conflict") {
          throw draftVersionConflict(claimed.draft.version);
        }
        if (claimed.kind === "invalid_state") {
          throw draftStateConflict(claimed.draft.status);
        }
        if (claimed.kind === "confirmation_missing") {
          throw confirmationConflict("UNIFIED_INBOX_CONFIRMATION_MISSING");
        }
        if (claimed.kind === "confirmation_mismatch") {
          throw confirmationConflict("UNIFIED_INBOX_CONFIRMATION_MISMATCH");
        }
        if (claimed.kind === "confirmation_expired") {
          throw confirmationConflict("UNIFIED_INBOX_CONFIRMATION_EXPIRED");
        }

        try {
          const receipt = await this.provider.deliver(
            {
              item: claimed.item,
              draft: claimed.draft,
              confirmation: claimed.confirmation
            },
            options
          );
          const expectedDeliveryMode =
            this.provider.dataOrigin === "real" ? "real" : "simulated";
          if (receipt.deliveryMode !== expectedDeliveryMode) {
            throw new AppError({
              code: "INTERNAL_ERROR",
              message: "Unified Inbox Provider 返回了不兼容的投递模式。",
              statusCode: 503,
              retryable: true,
              details: {
                reason: "UNIFIED_INBOX_DELIVERY_MODE_MISMATCH"
              }
            });
          }
          const sentAt = this.clock.now().toISOString();
          const completed = await this.repository.completeSend({
            draftId,
            expectedVersion: request.expected_version,
            sentAt
          });
          if (completed.kind !== "updated") {
            throw new AppError({
              code: "INTERNAL_ERROR",
              message: "Unified Inbox 发送状态提交失败。",
              statusCode: 503,
              retryable: true,
              details: { reason: "UNIFIED_INBOX_SEND_COMMIT_FAILED" }
            });
          }
          return {
            draftId,
            itemId: completed.draft.itemId,
            status: "sent",
            version: completed.draft.version,
            sentAt,
            deliveryMode: receipt.deliveryMode
          };
        } catch (error) {
          await this.repository.releaseSend({
            draftId,
            expectedVersion: request.expected_version,
            updatedAt: this.clock.now().toISOString()
          });
          if (error instanceof AppError) {
            throw error;
          }
          throw new AppError({
            code: "INTERNAL_ERROR",
            message: "Unified Inbox Provider 投递失败。",
            statusCode: 503,
            retryable: true,
            details: { reason: "UNIFIED_INBOX_DELIVERY_FAILED" },
            cause: error
          });
        }
      }
    );
  }

  private async ensureReady(): Promise<void> {
    if ((await this.provider.health()) === "unavailable") {
      throw providerUnavailable();
    }
    this.initialization ??= this.provider
      .loadSnapshot()
      .then(async (snapshot) => this.repository.initialize(snapshot))
      .catch((error: unknown) => {
        this.initialization = undefined;
        throw error;
      });
    await this.initialization;
  }

  private async idempotentMutation<T>(
    operation: string,
    requestId: string,
    idempotencyKey: string,
    request: unknown,
    create: () => Promise<T>
  ): Promise<T> {
    const requestHash = canonicalRequestHash({ operation, request });
    const byRequest = await this.idempotency.claimOrGet({
      key: `unified-inbox:request:${requestId}`,
      requestHash,
      ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
      create: async () => {
        const byKey = await this.idempotency.claimOrGet({
          key: `unified-inbox:key:${idempotencyKey}`,
          requestHash,
          ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
          create
        });
        if (byKey.kind === "conflict_different_request") {
          throw idempotencyConflict();
        }
        return byKey.value;
      }
    });
    if (byRequest.kind === "conflict_different_request") {
      throw idempotencyConflict();
    }
    return byRequest.value as T;
  }
}

function providerUnavailable(): AppError {
  return new AppError({
    code: "INTERNAL_ERROR",
    message: "Unified Inbox Provider 暂不可用。",
    statusCode: 503,
    retryable: true,
    details: { reason: "UNIFIED_INBOX_PROVIDER_UNAVAILABLE" }
  });
}

function idempotencyConflict(): AppError {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "request_id 或 Idempotency-Key 已用于不同请求。",
    statusCode: 409,
    retryable: false,
    details: { reason: "REQUEST_ID_REUSED" }
  });
}

function draftNotFound(): AppError {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "Unified Inbox draft 不存在。",
    statusCode: 404,
    retryable: false,
    details: { reason: "UNIFIED_INBOX_DRAFT_NOT_FOUND" }
  });
}

function draftVersionConflict(currentVersion: number): AppError {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "草稿版本已变化，请刷新后重试。",
    statusCode: 409,
    retryable: false,
    details: {
      reason: "UNIFIED_INBOX_DRAFT_VERSION_CONFLICT",
      current_version: currentVersion
    }
  });
}

function draftStateConflict(status: string): AppError {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "草稿当前状态不允许此操作。",
    statusCode: 409,
    retryable: false,
    details: {
      reason: "UNIFIED_INBOX_DRAFT_STATE_CONFLICT",
      status
    }
  });
}

function confirmationConflict(reason: string): AppError {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "发送确认无效或已过期，请重新确认。",
    statusCode: 409,
    retryable: false,
    details: { reason }
  });
}
