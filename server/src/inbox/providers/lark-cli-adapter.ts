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
}

interface LarkMessage {
  message_id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  create_time: string;
}

export class LarkCliAdapter implements InboxSource, InboxSender {
  readonly provider = "feishu" as const;
  readonly dataOrigin = "real" as const;

  constructor(
    private readonly config: LarkCliConfig,
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
      "im",
      "+messages-list",
      "--as",
      "user",
      "--limit",
      String(input.limit),
      "--output",
      "json"
    ];
    if (input.checkpoint) {
      args.push("--page-token", input.checkpoint);
    }
    const payload = parseObject(
      await this.runner.run({
        executable: this.config.executable,
        args
      })
    );
    const messages = Array.isArray(payload.items)
      ? (payload.items as LarkMessage[])
      : [];
    return {
      items: messages.map((message) =>
        this.mapMessage(message, input.accountId)
      ),
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
          "im",
          "+messages-send",
          "--as",
          "user",
          "--receive-id-type",
          "chat_id",
          "--receive-id",
          input.conversationId,
          "--content",
          JSON.stringify({ text: input.content }),
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
        typeof payload.message_id === "string"
          ? payload.message_id
          : null,
      sent_at: new Date().toISOString()
    };
  }

  private mapMessage(
    message: LarkMessage,
    accountId: string
  ): InboxEvent {
    return {
      provider: this.provider,
      account_id: accountId,
      conversation_id: message.chat_id,
      provider_message_id: message.message_id,
      sender: message.sender_id,
      recipients: [accountId],
      subject: null,
      content: message.text,
      received_at: message.create_time,
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
