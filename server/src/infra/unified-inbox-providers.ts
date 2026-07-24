import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../domain/errors.js";
import type {
  ProviderCallOptions,
  ProviderHealth,
  UnifiedInboxProvider
} from "../domain/ports.js";
import type {
  UnifiedInboxDeliveryReceipt,
  UnifiedInboxDeliveryRequest,
  UnifiedInboxDraft,
  UnifiedInboxItemDetail,
  UnifiedInboxItemStatus,
  UnifiedInboxPriority,
  UnifiedInboxSnapshot,
  UnifiedInboxSource
} from "../domain/unified-inbox.js";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

interface FixtureList {
  items: FixtureSummary[];
}

interface FixtureSummary {
  id: string;
  source: UnifiedInboxSource;
  conversation_name: string;
  sender_display_name: string;
  subject: string;
  preview: string;
  received_at: string;
  needs_reply: boolean;
  is_unread: boolean;
  priority: UnifiedInboxPriority;
  status: UnifiedInboxItemStatus;
  draft_id: string | null;
}

export class CannedUnifiedInboxProvider
  implements UnifiedInboxProvider
{
  readonly dataOrigin = "mock" as const;
  private readonly snapshot: UnifiedInboxSnapshot;

  constructor(snapshot: UnifiedInboxSnapshot = loadFixtureSnapshot()) {
    this.snapshot = structuredClone(snapshot);
  }

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async loadSnapshot(
    options?: ProviderCallOptions
  ): Promise<UnifiedInboxSnapshot> {
    throwIfAborted(options);
    return structuredClone(this.snapshot);
  }

  async deliver(
    _request: UnifiedInboxDeliveryRequest,
    options?: ProviderCallOptions
  ): Promise<UnifiedInboxDeliveryReceipt> {
    throwIfAborted(options);
    return { deliveryMode: "simulated" };
  }
}

export class UnavailableUnifiedInboxProvider
  implements UnifiedInboxProvider
{
  readonly dataOrigin = "mock" as const;

  async health(): Promise<ProviderHealth> {
    return "unavailable";
  }

  async loadSnapshot(): Promise<UnifiedInboxSnapshot> {
    throw unavailableError();
  }

  async deliver(): Promise<UnifiedInboxDeliveryReceipt> {
    throw unavailableError();
  }
}

function loadFixtureSnapshot(): UnifiedInboxSnapshot {
  const fixturePath = resolve(
    sourceDirectory,
    "../../../contracts/fixtures/unified-inbox-items.json"
  );
  const fixture = JSON.parse(
    readFileSync(fixturePath, "utf8")
  ) as FixtureList;
  const items = fixture.items.map(toDetail);
  const drafts = items
    .filter(
      (item): item is UnifiedInboxItemDetail & { draftId: string } =>
        item.draftId !== null
    )
    .map(toDraft);
  return { items, drafts };
}

function toDetail(item: FixtureSummary): UnifiedInboxItemDetail {
  return {
    id: item.id,
    source: item.source,
    conversationName: item.conversation_name,
    senderDisplayName: item.sender_display_name,
    subject: item.subject,
    preview: item.preview,
    receivedAt: item.received_at,
    needsReply: item.needs_reply,
    isUnread: item.is_unread,
    priority: item.priority,
    status: item.status,
    draftId: item.draft_id,
    body: `${item.preview} This is synthetic fixture content.`,
    participants: [
      {
        displayName: item.sender_display_name,
        address: null
      }
    ],
    attachments: [],
    providerCapabilities: {
      canAcknowledge: true,
      canDraftReply: true,
      canSendReply: true,
      supportsAttachments: false
    },
    acknowledgedAt: item.is_unread ? null : item.received_at
  };
}

function toDraft(
  item: UnifiedInboxItemDetail & { draftId: string }
): UnifiedInboxDraft {
  return {
    id: item.draftId,
    itemId: item.id,
    body: "Thanks for the mock message. I will follow up shortly.",
    status: "editing",
    version: 1,
    updatedAt: "2026-07-24T10:15:00+08:00",
    confirmationState: "none",
    sentAt: null
  };
}

function unavailableError(): AppError {
  return new AppError({
    code: "INTERNAL_ERROR",
    message: "Unified Inbox Provider 暂不可用。",
    statusCode: 503,
    retryable: true,
    details: { reason: "UNIFIED_INBOX_PROVIDER_UNAVAILABLE" }
  });
}

function throwIfAborted(options?: ProviderCallOptions): void {
  if (options?.signal?.aborted) {
    throw options.signal.reason ?? new Error("Provider call aborted.");
  }
}
