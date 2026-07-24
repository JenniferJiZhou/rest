import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
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

export interface QqMailCredentials {
  address: string;
  authorizationCode: string;
}

export interface QqMailConfig {
  accountId: string;
  credentials(): Promise<QqMailCredentials>;
}

export interface QqRuntimeMessage {
  uid: number;
  messageId: string;
  from: string;
  to: string[];
  subject: string | null;
  text: string;
  receivedAt: string;
}

export interface QqMailRuntime {
  pull(
    credentials: QqMailCredentials,
    afterUid: number | null,
    limit: number
  ): Promise<{ messages: QqRuntimeMessage[]; checkpoint: number }>;
  send(
    credentials: QqMailCredentials,
    message: Record<string, unknown>
  ): Promise<{ messageId: string | null }>;
}

export class QqMailAdapter implements InboxSource, InboxSender {
  readonly provider = "qq_mail" as const;
  readonly dataOrigin = "real" as const;

  constructor(
    private readonly config: QqMailConfig,
    private readonly runtime: QqMailRuntime =
      new NodeQqMailRuntime()
  ) {}

  async health(): Promise<"ready" | "unavailable"> {
    return this.config.accountId ? "ready" : "unavailable";
  }

  async pull(input: {
    accountId: string;
    checkpoint: string | null;
    limit: number;
  }): Promise<{ items: InboxEvent[]; checkpoint: string }> {
    this.assertAccount(input.accountId);
    const afterUid = input.checkpoint === null
      ? null
      : parseCheckpoint(input.checkpoint);
    const credentials = await this.config.credentials();
    const result = await this.runtime.pull(
      credentials,
      afterUid,
      input.limit
    );
    return {
      checkpoint: String(result.checkpoint),
      items: result.messages.map((message) => ({
        provider: this.provider,
        account_id: input.accountId,
        conversation_id: null,
        provider_message_id: message.messageId,
        sender: message.from,
        recipients: message.to,
        subject: message.subject,
        content: message.text,
        received_at: message.receivedAt,
        coverage: {
          source: "imap",
          complete: true,
          note: null
        }
      }))
    };
  }

  async send(input: InboxSendInput): Promise<InboxSendResult> {
    this.assertAccount(input.accountId);
    const credentials = await this.config.credentials();
    try {
      const result = await this.runtime.send(credentials, {
        from: credentials.address,
        to: input.replyTo,
        subject: replySubject(input.subject),
        ...(input.contentType === "html"
          ? { html: input.content }
          : { text: input.content }),
        inReplyTo: input.providerMessageId,
        references: [input.providerMessageId],
        headers: { "X-Hush-Idempotency-Key": input.idempotencyKey }
      });
      return {
        draft_id: input.draftId,
        provider: this.provider,
        status: "sent",
        provider_message_id: result.messageId,
        sent_at: new Date().toISOString()
      };
    } catch (error) {
      if (isTimeout(error)) {
        return {
          draft_id: input.draftId,
          provider: this.provider,
          status: "unknown",
          provider_message_id: null,
          sent_at: null
        };
      }
      throw new AppError({
        code: "INBOX_PROVIDER_UNAVAILABLE",
        message: "QQ 邮箱发送暂时不可用。",
        statusCode: 503,
        retryable: true,
        details: { provider: "qq_mail", reason: "smtp_failed" }
      });
    }
  }

  private assertAccount(accountId: string): void {
    if (accountId !== this.config.accountId) {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "QQ 邮箱账号不匹配。",
        statusCode: 400
      });
    }
  }
}

export class NodeQqMailRuntime implements QqMailRuntime {
  async pull(
    credentials: QqMailCredentials,
    afterUid: number | null,
    limit: number
  ): Promise<{ messages: QqRuntimeMessage[]; checkpoint: number }> {
    const client = new ImapFlow({
      host: "imap.qq.com",
      port: 993,
      secure: true,
      auth: {
        user: credentials.address,
        pass: credentials.authorizationCode
      },
      logger: false,
      socketTimeout: 30_000
    });
    const messages: QqRuntimeMessage[] = [];
    let checkpoint = afterUid ?? 0;
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const range = `${(afterUid ?? 0) + 1}:*`;
      for await (const message of client.fetch(
        range,
        {
          uid: true,
          envelope: true,
          bodyParts: ["TEXT"]
        },
        { uid: true }
      )) {
        if (!message.uid || !message.envelope) {
          continue;
        }
        const envelope = message.envelope;
        const body = message.bodyParts
          ?.get("TEXT")
          ?.toString("utf8")
          .trim();
        messages.push({
          uid: message.uid,
          messageId:
            envelope.messageId ?? `qq-uid-${message.uid}`,
          from:
            envelope.from?.[0]?.address ?? "unknown@qq.invalid",
          to: (envelope.to ?? [])
            .map((address) => address.address)
            .filter((address): address is string => Boolean(address)),
          subject: envelope.subject ?? null,
          text: body || "(无纯文本正文)",
          receivedAt:
            envelope.date?.toISOString() ?? new Date(0).toISOString()
        });
        checkpoint = Math.max(checkpoint, message.uid);
        if (messages.length >= limit) {
          break;
        }
      }
    } finally {
      lock.release();
      await client.logout();
    }
    return { messages, checkpoint };
  }

  async send(
    credentials: QqMailCredentials,
    message: Record<string, unknown>
  ): Promise<{ messageId: string | null }> {
    const transport = nodemailer.createTransport({
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      auth: {
        user: credentials.address,
        pass: credentials.authorizationCode
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000
    });
    const result = await transport.sendMail(message);
    transport.close();
    return { messageId: result.messageId || null };
  }
}

function parseCheckpoint(value: string): number {
  const checkpoint = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(checkpoint) || checkpoint < 0) {
    throw new AppError({
      code: "INVALID_REQUEST",
      message: "QQ 邮箱同步 checkpoint 无效。",
      statusCode: 400
    });
  }
  return checkpoint;
}

function replySubject(subject: string | null): string {
  const value = subject?.trim() || "(无主题)";
  return /^re:/iu.test(value) ? value : `Re: ${value}`;
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code =
    "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  return (
    ["ETIMEDOUT", "ESOCKET", "ECONNECTION"].includes(code) ||
    /timed?\s*out/iu.test(error.message)
  );
}
