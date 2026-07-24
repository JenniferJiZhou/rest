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

export interface DingTalkDwsConfig {
  executable: string;
  accountId: string;
  now?: () => Date;
  timeZone?: string;
}

interface DingTalkMessage {
  messageId?: unknown;
  conversationId?: unknown;
  conversationType?: unknown;
  conversationName?: unknown;
  senderId?: unknown;
  sender?: unknown;
  text?: unknown;
  content?: unknown;
  createdAt?: unknown;
  createTime?: unknown;
}

interface DingTalkCheckpoint {
  start: string;
  end: string;
  cursor?: string;
}

export class DingTalkDwsAdapter implements InboxSource, InboxSender {
  readonly provider = "dingtalk" as const;
  readonly dataOrigin = "real" as const;

  constructor(
    private readonly config: DingTalkDwsConfig,
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
      "chat",
      "message",
      "list-all",
      "--start",
      formatDingTalkTime(
        checkpoint.start,
        this.config.timeZone ?? "Asia/Shanghai"
      ),
      "--end",
      formatDingTalkTime(
        checkpoint.end,
        this.config.timeZone ?? "Asia/Shanghai"
      ),
      "--limit",
      String(Math.min(input.limit, 50)),
      "--cursor",
      checkpoint.cursor ?? "0",
      "--format",
      "json"
    ];
    const payload = parseObject(
      await this.runner.run({
        executable: this.config.executable,
        args
      })
    );
    const result = unwrap(payload);
    const hasMore =
      typeof result.hasMore === "boolean"
        ? result.hasMore
        : result.has_more;
    if (
      !Array.isArray(result.messages) ||
      typeof hasMore !== "boolean"
    ) {
      throw providerOutputError();
    }
    const messages = result.messages as DingTalkMessage[];
    const items = messages.flatMap((message) => {
      const mapped = this.mapMessage(message, input.accountId);
      return mapped ? [mapped] : [];
    });
    const nextCursor =
      stringValue(result.nextCursor) ??
      stringValue(result.next_cursor);
    if (hasMore && !nextCursor) {
      throw providerOutputError();
    }
    return {
      items,
      checkpoint:
        hasMore && nextCursor
          ? JSON.stringify({
              start: checkpoint.start,
              end: checkpoint.end,
              cursor: nextCursor
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
        args: [
          "chat",
          "message",
          "send",
          "--group",
          input.conversationId,
          "--title",
          input.subject?.trim() || "Hush 回复",
          "--text",
          "@-",
          "--yes",
          "--format",
          "json"
        ],
        input: input.content,
        ambiguousOnTimeout: true
      })
    );
    const result = unwrap(payload);
    return {
      draft_id: input.draftId,
      provider: this.provider,
      status: "sent",
      provider_message_id:
        typeof result.messageId === "string"
          ? result.messageId
          : typeof result.message_id === "string"
            ? result.message_id
          : null,
      sent_at: new Date().toISOString()
    };
  }

  private mapMessage(
    message: DingTalkMessage,
    accountId: string
  ): InboxEvent | null {
    const messageId = stringValue(message.messageId);
    const conversationId = stringValue(message.conversationId);
    const conversationType = conversationTypeValue(message.conversationType);
    const receivedAt = timestampValue(
      message.createdAt ?? message.createTime
    );
    if (!messageId || !conversationId || !conversationType || !receivedAt) {
      return null;
    }
    return {
      provider: this.provider,
      account_id: accountId,
      conversation_id: conversationId,
      conversation_type: conversationType,
      conversation_name:
        stringValue(message.conversationName) ??
        (conversationType === "group" ? "钉钉群聊" : "钉钉会话"),
      provider_message_id: messageId,
      sender: senderValue(message.sender, message.senderId),
      sender_ref: null,
      recipients: [accountId],
      subject: null,
      content: contentValue(message.text ?? message.content),
      received_at: receivedAt,
      coverage: {
        source: "official_api",
        complete: false,
        note: "可见范围受钉钉企业授权和当前用户会话权限限制"
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
): DingTalkCheckpoint {
  if (value) {
    try {
      const parsed = JSON.parse(value) as Partial<DingTalkCheckpoint>;
      if (
        timestampValue(parsed.start) &&
        timestampValue(parsed.end)
      ) {
        return {
          start: new Date(parsed.start!).toISOString(),
          end: new Date(parsed.end!).toISOString(),
          ...(stringValue(parsed.cursor)
            ? { cursor: stringValue(parsed.cursor)! }
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

function formatDingTalkTime(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function unwrap(
  payload: Record<string, unknown>
): Record<string, unknown> {
  for (const key of ["result", "data"]) {
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
    for (const key of ["name", "nick", "displayName"]) {
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
    message: "钉钉命令返回了无法识别的结果。",
    statusCode: 503,
    retryable: true,
    details: { provider: "dingtalk", reason: "invalid_output" }
  });
}

function invalidTarget(): AppError {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "钉钉账号或会话目标无效。",
    statusCode: 400
  });
}
