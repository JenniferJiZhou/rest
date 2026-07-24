import { AppError } from "../../domain/errors.js";
import type {
  InboxEvent,
  InboxSendResult
} from "../../domain/contracts.js";
import type {
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
  }): Promise<{ items: InboxEvent[]; checkpoint: string }> {
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
    const items = messages.flatMap((message) => {
      const mapped = this.mapMessage(message, input.accountId);
      return mapped ? [mapped] : [];
    });
    const pageToken = stringValue(result.page_token);
    if (result.has_more && !pageToken) {
      throw providerOutputError();
    }
    return {
      items,
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
          input.content,
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
  ): InboxEvent | null {
    const messageId = stringValue(message.message_id);
    const chatId = stringValue(message.chat_id);
    const conversationType = conversationTypeValue(message.chat_type);
    const receivedAt = timestampValue(message.create_time);
    if (!messageId || !chatId || !conversationType || !receivedAt) {
      return null;
    }
    return {
      provider: this.provider,
      account_id: accountId,
      conversation_id: chatId,
      conversation_type: conversationType,
      conversation_name:
        stringValue(message.chat_name) ??
        stringValue(message.conversation_name) ??
        (conversationType === "group" ? "飞书群聊" : "飞书会话"),
      provider_message_id: messageId,
      sender: senderValue(message.sender, message.sender_id),
      sender_ref: null,
      recipients: [accountId],
      subject: null,
      content: contentValue(message.content),
      received_at: receivedAt,
      coverage: {
        source: "official_api",
        complete: false,
        note: "可见范围受飞书应用权限、租户策略和会话成员资格限制"
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

function senderValue(sender: unknown, _fallback: unknown): string {
  if (typeof sender === "string" && sender.length > 0) {
    return sender;
  }
  if (typeof sender === "object" && sender !== null) {
    const record = sender as Record<string, unknown>;
    for (const key of ["name", "display_name", "nickname"]) {
      const value = stringValue(record[key]);
      if (value) {
        return value;
      }
    }
  }
  return "未知发送者";
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

function contentValue(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (typeof content === "object" && content !== null) {
    const text = stringValue(
      (content as Record<string, unknown>).text
    );
    return text ?? JSON.stringify(content);
  }
  return "";
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
