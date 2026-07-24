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
}

interface DingTalkMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export class DingTalkDwsAdapter implements InboxSource, InboxSender {
  readonly provider = "dingtalk" as const;
  readonly dataOrigin = "real" as const;

  constructor(
    private readonly config: DingTalkDwsConfig,
    private readonly runner: CommandRunner
  ) {}

  async health(): Promise<"ready" | "unavailable"> {
    return this.config.executable ? "ready" : "unavailable";
  }

  async pull(input: {
    accountId: string;
    checkpoint: string | null;
    limit: number;
  }): Promise<{ items: InboxEvent[]; checkpoint: string }> {
    this.assertAccount(input.accountId);
    const args = [
      "chat",
      "message",
      "list-all",
      "--limit",
      String(input.limit),
      "--output",
      "json"
    ];
    if (input.checkpoint) {
      args.push("--cursor", input.checkpoint);
    }
    const payload = parseObject(
      await this.runner.run({
        executable: this.config.executable,
        args
      })
    );
    const messages = Array.isArray(payload.messages)
      ? (payload.messages as DingTalkMessage[])
      : [];
    return {
      items: messages.map((message) => ({
        provider: this.provider,
        account_id: input.accountId,
        conversation_id: message.conversationId,
        provider_message_id: message.messageId,
        sender: message.senderId,
        recipients: [input.accountId],
        subject: null,
        content: message.text,
        received_at: message.createdAt,
        coverage: {
          source: "official_api",
          complete: false,
          note: "可见范围受钉钉企业授权和当前用户会话权限限制"
        }
      })),
      checkpoint:
        typeof payload.checkpoint === "string"
          ? payload.checkpoint
          : input.checkpoint ?? "initial"
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
          "--conversation-id",
          input.conversationId,
          "--text",
          input.content,
          "--output",
          "json"
        ]
      })
    );
    return {
      draft_id: input.draftId,
      provider: this.provider,
      status: "sent",
      provider_message_id:
        typeof payload.messageId === "string"
          ? payload.messageId
          : null,
      sent_at: new Date().toISOString()
    };
  }

  private assertAccount(accountId: string): void {
    if (accountId !== this.config.accountId) {
      throw invalidTarget();
    }
  }
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
  throw new AppError({
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
