import { z } from "zod";
import {
  inboxDraftSchema,
  inboxSendResultSchema,
  inboxSyncStatusSchema,
  unifiedInboxItemSchema,
  type InboxDraft,
  type InboxSendResult,
  type InboxSyncStatus,
  type UnifiedInboxItem
} from "../domain/contracts.js";
import type {
  InboxParticipantBinding,
  InboxSourceMessage
} from "./ports.js";

export interface InboxStateBackend {
  read<T>(
    reader: (state: Readonly<InboxPersistedState>) => T
  ): Promise<T>;
  mutate<T>(
    mutation: (state: InboxPersistedState) => {
      state: InboxPersistedState;
      value: T;
    }
  ): Promise<T>;
}

export interface InboxPersistedState {
  state_version: 1;
  items: Record<string, UnifiedInboxItem>;
  source_messages: Record<string, InboxSourceMessage[]>;
  dedupe_item_ids: Record<string, string>;
  open_digest_ids: Record<string, string>;
  drafts: Record<string, InboxDraft>;
  participant_bindings: Record<string, InboxParticipantBinding>;
  checkpoints: Record<string, InboxSyncStatus>;
  completed_send_claims: Record<
    string,
    {
      request_hash: string;
      result: InboxSendResult;
      expires_at: string;
    }
  >;
}

const inboxSourceMessageSchema = z
  .object({
    providerMessageId: z.string().min(1),
    senderRef: z.string().min(1).nullable(),
    senderDisplayName: z.string().min(1).nullable(),
    content: z.string().min(1),
    receivedAt: z.iso.datetime({ offset: true })
  })
  .strict();

const inboxParticipantBindingSchema = z
  .object({
    provider: z.enum(["feishu", "dingtalk", "outlook", "qq_mail"]),
    accountId: z.string().min(1),
    conversationId: z.string().min(1),
    participantRef: z.string().min(1),
    providerParticipantId: z.string().min(1),
    displayName: z.string().min(1)
  })
  .strict();

const completedSendClaimSchema = z
  .object({
    request_hash: z.string().min(1),
    result: inboxSendResultSchema,
    expires_at: z.iso.datetime({ offset: true })
  })
  .strict();

export const inboxPersistedStateSchema: z.ZodType<InboxPersistedState> = z
  .object({
    state_version: z.literal(1),
    items: z.record(z.string(), unifiedInboxItemSchema),
    source_messages: z.record(
      z.string(),
      z.array(inboxSourceMessageSchema)
    ),
    dedupe_item_ids: z.record(z.string(), z.string().min(1)),
    open_digest_ids: z.record(z.string(), z.string().min(1)),
    drafts: z.record(z.string(), inboxDraftSchema),
    participant_bindings: z.record(
      z.string(),
      inboxParticipantBindingSchema
    ),
    checkpoints: z.record(z.string(), inboxSyncStatusSchema),
    completed_send_claims: z.record(
      z.string(),
      completedSendClaimSchema
    )
  })
  .strict();

export function emptyInboxPersistedState(): InboxPersistedState {
  return {
    state_version: 1,
    items: {},
    source_messages: {},
    dedupe_item_ids: {},
    open_digest_ids: {},
    drafts: {},
    participant_bindings: {},
    checkpoints: {},
    completed_send_claims: {}
  };
}

export class InMemoryInboxStateBackend implements InboxStateBackend {
  private state: InboxPersistedState;

  constructor(initialState: InboxPersistedState = emptyInboxPersistedState()) {
    this.state = inboxPersistedStateSchema.parse(
      structuredClone(initialState)
    );
  }

  read<T>(
    reader: (state: Readonly<InboxPersistedState>) => T
  ): Promise<T> {
    try {
      return Promise.resolve(reader(structuredClone(this.state)));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  mutate<T>(
    mutation: (state: InboxPersistedState) => {
      state: InboxPersistedState;
      value: T;
    }
  ): Promise<T> {
    try {
      const result = mutation(structuredClone(this.state));
      this.state = inboxPersistedStateSchema.parse(result.state);
      return Promise.resolve(structuredClone(result.value));
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
