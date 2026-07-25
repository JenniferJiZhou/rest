import { createHash } from "node:crypto";
import { AppError } from "../../domain/errors.js";
import type {
  InboxEvent,
  InboxSendResult
} from "../../domain/contracts.js";
import type {
  InboxParticipantBinding,
  InboxSendInput,
  InboxSender,
  InboxSource
} from "../ports.js";
import type { CommandRunner } from "./command-runner.js";

export interface LarkCliConfig {
  executable: string;
  accountId: string;
  now?: () => Date;
}

interface LarkMessage {
  message_id?: unknown;
  chat_id?: unknown;
  chat_type?: unknown;
  chat_name?: unknown;
  chat_partner?: unknown;
  conversation_name?: unknown;
  sender_id?: unknown;
  sender?: unknown;
  content?: unknown;
  create_time?: unknown;
}

interface LarkCheckpoint {
  start: string;
  end: string;
  pageToken?: string;
}

export class LarkCliAdapter implements InboxSource, InboxSender {
  readonly provider = "feishu" as const;
  readonly dataOrigin = "real" as const;

  constructor(
    private readonly config: LarkCliConfig,
    private readonly runner: CommandRunner
  ) {}

  async health(): Promise<"ready" | "degraded" | "unavailable"> {
    if (!this.config.executable) {
      return "unavailable";
    }
    try {
      await this.runner.run({
        executable: this.config.executable,
        args: ["auth", "status", "--format", "json"]
      });
      return "ready";
    } catch {
      return "degraded";
    }
  }

  async pull(input: {
    accountId: string;
    checkpoint: string | null;
    limit: number;
  }): Promise<{
    items: InboxEvent[];
    checkpoint: string;
    participantBindings: InboxParticipantBinding[];
  }> {
    this.assertAccount(input.accountId);
    const checkpoint = resolveCheckpoint(
      input.checkpoint,
      this.config.now?.() ?? new Date()
    );
    const args = [
      "im",
      "+messages-search",
      "--as",
      "user",
      "--query",
      "",
      "--start",
      checkpoint.start,
      "--end",
      checkpoint.end,
      "--page-size",
      String(Math.min(input.limit, 50)),
      "--format",
      "json"
    ];
    if (checkpoint.pageToken) {
      args.push("--page-token", checkpoint.pageToken);
    }
    const payload = parseObject(
      await this.runner.run({
        executable: this.config.executable,
        args
      })
    );
    const result = unwrap(payload);
    if (
      !Array.isArray(result.items) ||
      typeof result.has_more !== "boolean"
    ) {
      throw providerOutputError();
    }
    const messages = result.items as LarkMessage[];
    const mappedMessages = messages.map((message) =>
      this.mapMessage(message, input.accountId)
    );
    const bindings = new Map<string, InboxParticipantBinding>();
    for (const mapped of mappedMessages) {
      bindings.set(mapped.binding.participantRef, mapped.binding);
    }
    const pageToken = stringValue(result.page_token);
    if (result.has_more && !pageToken) {
      throw providerOutputError();
    }
    return {
      items: mappedMessages.map(({ item }) => item),
      participantBindings: [...bindings.values()],
      checkpoint:
        result.has_more === true && pageToken
          ? JSON.stringify({
              start: checkpoint.start,
              end: checkpoint.end,
              pageToken
            })
          : checkpoint.end
    };
  }

  async send(input: InboxSendInput): Promise<InboxSendResult> {
    this.assertAccount(input.accountId);
    if (!input.conversationId) {
      throw invalidTarget();
    }
    const mentionPrefix = input.mentions
      .map(
        (mention) =>
          `<at user_id="${escapeFeishuAttribute(
            mention.providerParticipantId
          )}">${escapeFeishuText(mention.displayName)}</at>`
      )
      .join(" ");
    const text = mentionPrefix
      ? `${mentionPrefix}\n${input.content}`
      : input.content;
    const payload = parseObject(
      await this.runner.run({
        executable: this.config.executable,
        ambiguousOnTimeout: true,
        args: [
          "im",
          "+messages-send",
          "--as",
          "user",
          "--chat-id",
          input.conversationId,
          "--text",
          text,
          "--idempotency-key",
          input.idempotencyKey.slice(0, 50),
          "--format",
          "json"
        ]
      })
    );
    const result = unwrap(payload);
    return {
      draft_id: input.draftId,
      provider: this.provider,
      status: "sent",
      provider_message_id:
        typeof result.message_id === "string"
          ? result.message_id
          : null,
      sent_at: new Date().toISOString()
    };
  }

  private mapMessage(
    message: LarkMessage,
    accountId: string
  ): {
    item: InboxEvent;
    binding: InboxParticipantBinding;
  } {
    const messageId = stringValue(message.message_id);
    const chatId = stringValue(message.chat_id);
    const conversationType = conversationTypeValue(message.chat_type);
    const conversationName = conversationNameValue(
      message,
      conversationType
    );
    const sender = senderIdentity(message.sender, message.sender_id);
    const content = contentValue(message.content);
    const receivedAt = timestampValue(message.create_time);
    if (
      !messageId ||
      !chatId ||
      !conversationType ||
      !conversationName ||
      !sender ||
      !content ||
      !receivedAt
    ) {
      throw providerOutputError();
    }
    const participantRef = participantReference(
      accountId,
      chatId,
      sender.id
    );
    return {
      item: {
        provider: this.provider,
        account_id: accountId,
        conversation_id: chatId,
        conversation_type: conversationType,
        conversation_name: conversationName,
        provider_message_id: messageId,
        sender: sender.name,
        sender_ref: participantRef,
        recipients: [accountId],
        subject: null,
        content,
        received_at: receivedAt,
        coverage: {
          source: "official_api",
          complete: false,
          note: "可见范围受飞书应用权限、租户策略和会话成员资格限制"
        }
      },
      binding: {
        provider: this.provider,
        accountId,
        conversationId: chatId,
        participantRef,
        providerParticipantId: sender.id,
        displayName: sender.name
      }
    };
  }

  private assertAccount(accountId: string): void {
    if (accountId !== this.config.accountId) {
      throw invalidTarget();
    }
  }
}

function resolveCheckpoint(
  value: string | null,
  now: Date
): LarkCheckpoint {
  if (value) {
    try {
      const parsed = JSON.parse(value) as Partial<LarkCheckpoint>;
      if (
        timestampValue(parsed.start) &&
        timestampValue(parsed.end)
      ) {
        return {
          start: new Date(parsed.start!).toISOString(),
          end: new Date(parsed.end!).toISOString(),
          ...(stringValue(parsed.pageToken)
            ? { pageToken: stringValue(parsed.pageToken)! }
            : {})
        };
      }
    } catch {
      const start = timestampValue(value);
      if (start) {
        return { start, end: now.toISOString() };
      }
    }
  }
  return {
    start: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    end: now.toISOString()
  };
}

function unwrap(
  payload: Record<string, unknown>
): Record<string, unknown> {
  for (const key of ["data", "result"]) {
    const nested = payload[key];
    if (typeof nested === "object" && nested !== null) {
      return nested as Record<string, unknown>;
    }
  }
  return payload;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function senderIdentity(
  sender: unknown,
  fallbackId: unknown
): { id: string; name: string } | null {
  const fallback = stringValue(fallbackId);
  if (typeof sender === "object" && sender !== null) {
    const record = sender as Record<string, unknown>;
    const id =
      stringValue(record.id) ??
      stringValue(record.open_id) ??
      stringValue(record.user_id) ??
      fallback;
    for (const key of ["name", "display_name", "nickname"]) {
      const name = stringValue(record[key]);
      if (id && name) {
        return { id, name };
      }
    }
  }
  const name = stringValue(sender);
  return fallback && name ? { id: fallback, name } : null;
}

function conversationNameValue(
  message: LarkMessage,
  conversationType: "direct" | "group" | null
): string | null {
  if (conversationType === "group") {
    return (
      stringValue(message.chat_name) ??
      stringValue(message.conversation_name)
    );
  }
  if (conversationType === "direct") {
    const partner =
      typeof message.chat_partner === "object" &&
      message.chat_partner !== null
        ? (message.chat_partner as Record<string, unknown>)
        : null;
    return (
      stringValue(partner?.name) ??
      stringValue(partner?.display_name) ??
      stringValue(message.chat_name) ??
      stringValue(message.conversation_name)
    );
  }
  return null;
}

function participantReference(
  accountId: string,
  chatId: string,
  providerParticipantId: string
): string {
  const digest = createHash("sha256")
    .update(
      ["feishu", accountId, chatId, providerParticipantId].join("\u0000")
    )
    .digest("base64url")
    .slice(0, 32);
  return `participant_${digest}`;
}

function conversationTypeValue(value: unknown): "direct" | "group" | null {
  switch (stringValue(value)?.trim().toLowerCase()) {
    case "group":
      return "group";
    case "p2p":
    case "direct":
      return "direct";
    default:
      return null;
  }
}

function contentValue(content: unknown): string | null {
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed.startsWith("{")) {
      try {
        return structuredContentValue(JSON.parse(trimmed));
      } catch {
        return null;
      }
    }
    return sanitizeFeishuMarkup(content);
  }
  return structuredContentValue(content);
}

function structuredContentValue(content: unknown): string | null {
  if (
    typeof content !== "object" ||
    content === null ||
    Array.isArray(content)
  ) {
    return null;
  }
  const record = content as Record<string, unknown>;
  if (!Object.keys(record).every((key) => key === "text" || key === "mentions")) {
    return null;
  }
  const text = stringValue(record.text);
  if (!text || !validMentions(record.mentions)) {
    return null;
  }
  return sanitizeFeishuMarkup(text);
}

function validMentions(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  return (
    Array.isArray(value) &&
    value.every((mention) => {
      if (
        typeof mention !== "object" ||
        mention === null ||
        Array.isArray(mention)
      ) {
        return false;
      }
      const record = mention as Record<string, unknown>;
      if (
        !Object.keys(record).every((key) =>
          ["id", "open_id", "user_id", "name", "display_name"].includes(key)
        )
      ) {
        return false;
      }
      const identifier =
        stringValue(record.user_id) ??
        stringValue(record.open_id) ??
        stringValue(record.id);
      const displayName =
        stringValue(record.name) ?? stringValue(record.display_name);
      return Boolean(identifier && displayName);
    })
  );
}

function sanitizeFeishuMarkup(value: string): string | null {
  const sanitized = value.replace(
    /<at\b[^>]*>([^<]*)<\/at>/gi,
    "$1"
  );
  if (/<\/?at\b/i.test(sanitized)) {
    return null;
  }
  return stringValue(sanitized);
}

function timestampValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const raw = String(value);
  const numeric = Number(raw);
  const date = Number.isFinite(numeric)
    ? new Date(raw.length >= 13 ? numeric : numeric * 1000)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function escapeFeishuAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeFeishuText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseObject(output: string): Record<string, unknown> {
  try {
    const value = JSON.parse(output) as unknown;
    if (typeof value === "object" && value !== null) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Fall through to a sanitized provider error.
  }
  throw providerOutputError();
}

function providerOutputError(): AppError {
  return new AppError({
    code: "INBOX_PROVIDER_UNAVAILABLE",
    message: "飞书命令返回了无法识别的结果。",
    statusCode: 503,
    retryable: true,
    details: { provider: "feishu", reason: "invalid_output" }
  });
}

function invalidTarget(): AppError {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "飞书账号或会话目标无效。",
    statusCode: 400
  });
}
