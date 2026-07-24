import type {
  UnifiedInboxConfirmation,
  UnifiedInboxDraft,
  UnifiedInboxItemDetail,
  UnifiedInboxItemSummary,
  UnifiedInboxSendResult
} from "../domain/unified-inbox.js";

export function toInboxItemSummary(item: UnifiedInboxItemSummary) {
  return {
    id: item.id,
    source: item.source,
    conversation_name: item.conversationName,
    sender_display_name: item.senderDisplayName,
    subject: item.subject,
    preview: item.preview,
    received_at: item.receivedAt,
    needs_reply: item.needsReply,
    is_unread: item.isUnread,
    priority: item.priority,
    status: item.status,
    draft_id: item.draftId
  };
}

export function toInboxItemDetail(item: UnifiedInboxItemDetail) {
  return {
    ...toInboxItemSummary(item),
    body: item.body,
    participants: item.participants.map((participant) => ({
      display_name: participant.displayName,
      address: participant.address
    })),
    attachments: item.attachments.map((attachment) => ({
      id: attachment.id,
      file_name: attachment.fileName,
      media_type: attachment.mediaType,
      size_bytes: attachment.sizeBytes
    })),
    provider_capabilities: {
      can_acknowledge: item.providerCapabilities.canAcknowledge,
      can_draft_reply: item.providerCapabilities.canDraftReply,
      can_send_reply: item.providerCapabilities.canSendReply,
      supports_attachments:
        item.providerCapabilities.supportsAttachments
    },
    acknowledged_at: item.acknowledgedAt
  };
}

export function toInboxDraft(draft: UnifiedInboxDraft) {
  return {
    id: draft.id,
    item_id: draft.itemId,
    body: draft.body,
    status: draft.status,
    version: draft.version,
    updated_at: draft.updatedAt,
    confirmation_state: draft.confirmationState,
    sent_at: draft.sentAt
  };
}

export function toInboxConfirmation(
  confirmation: UnifiedInboxConfirmation
) {
  return {
    confirmation_id: confirmation.confirmationId,
    draft_id: confirmation.draftId,
    item_id: confirmation.itemId,
    source: confirmation.source,
    draft_version: confirmation.draftVersion,
    expires_at: confirmation.expiresAt
  };
}

export function toInboxSendResult(result: UnifiedInboxSendResult) {
  return {
    draft_id: result.draftId,
    item_id: result.itemId,
    status: result.status,
    version: result.version,
    sent_at: result.sentAt,
    delivery_mode: result.deliveryMode
  };
}
