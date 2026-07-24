import { z } from "zod";
import { CONTRACT_VERSION } from "./contracts.js";

export const unifiedInboxSourceSchema = z.enum([
  "feishu",
  "dingtalk",
  "outlook",
  "qq_mail"
]);
export const unifiedInboxPrioritySchema = z.enum([
  "high",
  "normal",
  "low",
  "uncertain"
]);
export const unifiedInboxItemStatusSchema = z.enum([
  "open",
  "acknowledged",
  "drafting",
  "discarded",
  "sent"
]);
export const unifiedInboxDraftStatusSchema = z.enum([
  "editing",
  "confirmed",
  "sending",
  "discarded",
  "sent"
]);
export const unifiedInboxConfirmationStateSchema = z.enum([
  "none",
  "confirmed",
  "expired",
  "invalidated",
  "consumed"
]);

const schemaVersion = z.literal(CONTRACT_VERSION);
const requestId = z.string().min(1);
const expectedVersion = z.number().int().min(1);
const safeDraftBody = z
  .string()
  .min(1)
  .max(10_000)
  .refine((value) => /\S/u.test(value), "body must contain non-whitespace text")
  .refine(
    (value) =>
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value),
    "body contains unsupported control characters"
  );

export const unifiedInboxListQuerySchema = z
  .object({
    cursor: z.string().regex(/^\d+$/u).optional(),
    source: unifiedInboxSourceSchema.optional(),
    status: unifiedInboxItemStatusSchema.optional(),
    needs_reply: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((value) => value === true || value === "true")
      .optional()
  })
  .strict();

export const unifiedInboxAcknowledgeRequestSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId
  })
  .strict();

export const unifiedInboxPatchDraftRequestSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        schema_version: schemaVersion,
        request_id: requestId,
        operation: z.literal("update_body"),
        expected_version: expectedVersion,
        body: safeDraftBody
      })
      .strict(),
    z
      .object({
        schema_version: schemaVersion,
        request_id: requestId,
        operation: z.literal("discard"),
        expected_version: expectedVersion
      })
      .strict()
  ]
);

export const unifiedInboxConfirmationRequestSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    expected_version: expectedVersion
  })
  .strict();

export const unifiedInboxSendRequestSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    confirmation_id: z.string().min(1).max(160),
    expected_version: expectedVersion
  })
  .strict();

export type UnifiedInboxSource = z.infer<
  typeof unifiedInboxSourceSchema
>;
export type UnifiedInboxPriority = z.infer<
  typeof unifiedInboxPrioritySchema
>;
export type UnifiedInboxItemStatus = z.infer<
  typeof unifiedInboxItemStatusSchema
>;
export type UnifiedInboxDraftStatus = z.infer<
  typeof unifiedInboxDraftStatusSchema
>;
export type UnifiedInboxConfirmationState = z.infer<
  typeof unifiedInboxConfirmationStateSchema
>;
export type UnifiedInboxListQuery = z.input<
  typeof unifiedInboxListQuerySchema
>;
export type UnifiedInboxPatchDraftRequest = z.infer<
  typeof unifiedInboxPatchDraftRequestSchema
>;
export type UnifiedInboxConfirmationRequest = z.infer<
  typeof unifiedInboxConfirmationRequestSchema
>;
export type UnifiedInboxSendRequest = z.infer<
  typeof unifiedInboxSendRequestSchema
>;

export interface UnifiedInboxItemSummary {
  id: string;
  source: UnifiedInboxSource;
  conversationName: string;
  senderDisplayName: string;
  subject: string;
  preview: string;
  receivedAt: string;
  needsReply: boolean;
  isUnread: boolean;
  priority: UnifiedInboxPriority;
  status: UnifiedInboxItemStatus;
  draftId: string | null;
}

export interface UnifiedInboxParticipant {
  displayName: string;
  address: string | null;
}

export interface UnifiedInboxAttachmentMetadata {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
}

export interface UnifiedInboxProviderCapabilities {
  canAcknowledge: boolean;
  canDraftReply: boolean;
  canSendReply: boolean;
  supportsAttachments: boolean;
}

export interface UnifiedInboxItemDetail
  extends UnifiedInboxItemSummary {
  body: string;
  participants: UnifiedInboxParticipant[];
  attachments: UnifiedInboxAttachmentMetadata[];
  providerCapabilities: UnifiedInboxProviderCapabilities;
  acknowledgedAt: string | null;
}

export interface UnifiedInboxDraft {
  id: string;
  itemId: string;
  body: string;
  status: UnifiedInboxDraftStatus;
  version: number;
  updatedAt: string;
  confirmationState: UnifiedInboxConfirmationState;
  sentAt: string | null;
}

export interface UnifiedInboxConfirmation {
  confirmationId: string;
  draftId: string;
  itemId: string;
  source: UnifiedInboxSource;
  draftVersion: number;
  expiresAt: string;
}

export interface UnifiedInboxSendResult {
  draftId: string;
  itemId: string;
  status: "sent";
  version: number;
  sentAt: string;
  deliveryMode: "simulated" | "real";
}

export interface UnifiedInboxSnapshot {
  items: UnifiedInboxItemDetail[];
  drafts: UnifiedInboxDraft[];
}

export interface UnifiedInboxListFilter {
  cursor?: string;
  source?: UnifiedInboxSource;
  status?: UnifiedInboxItemStatus;
  needsReply?: boolean;
}

export interface UnifiedInboxListPage {
  items: UnifiedInboxItemSummary[];
  nextCursor: string | null;
}

export interface UnifiedInboxDeliveryRequest {
  item: UnifiedInboxItemDetail;
  draft: UnifiedInboxDraft;
  confirmation: UnifiedInboxConfirmation;
}

export interface UnifiedInboxDeliveryReceipt {
  deliveryMode: "simulated" | "real";
}
