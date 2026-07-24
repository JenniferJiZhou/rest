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

export type GraphFetch = typeof fetch;

export interface OutlookGraphConfig {
  accountId: string;
  accessToken(): Promise<string>;
}

interface GraphMessage {
  id: string;
  "@removed"?: unknown;
  conversationId?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
}

export class OutlookGraphAdapter implements InboxSource, InboxSender {
  readonly provider = "outlook" as const;
  readonly dataOrigin = "real" as const;

  constructor(
    private readonly config: OutlookGraphConfig,
    private readonly request: GraphFetch = fetch
  ) {}

  async health(): Promise<"ready" | "degraded" | "unavailable"> {
    if (!this.config.accountId) {
      return "unavailable";
    }
    try {
      const token = await this.config.accessToken();
      const response = await this.request(
        "https://graph.microsoft.com/v1.0/me?$select=id",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return response.ok ? "ready" : "degraded";
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
    const candidateUrl =
      input.checkpoint ??
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top=${input.limit}&$select=id,conversationId,from,toRecipients,subject,bodyPreview,receivedDateTime`;
    const url = graphDeltaUrl(candidateUrl);
    const token = await this.config.accessToken();
    let response: Response;
    try {
      response = await this.request(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch {
      throw unavailable("network");
    }
    if (!response.ok) {
      throw unavailable(
        response.status === 429 ? "rate_limited" : "http_error",
        response.status
      );
    }
    const payload = (await response.json()) as {
      value?: GraphMessage[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };
    const checkpoint =
      payload["@odata.deltaLink"] ??
      payload["@odata.nextLink"] ??
      input.checkpoint;
    if (!checkpoint) {
      throw unavailable("missing_checkpoint");
    }
    const validatedCheckpoint = graphDeltaUrl(checkpoint);
    return {
      checkpoint: validatedCheckpoint,
      items: (payload.value ?? [])
        .filter((message) => message["@removed"] === undefined)
        .map((message) => this.mapMessage(message, input.accountId))
    };
  }

  async send(input: InboxSendInput): Promise<InboxSendResult> {
    this.assertAccount(input.accountId);
    const token = await this.config.accessToken();
    let response: Response;
    try {
      response = await this.request(
        `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(input.providerMessageId)}/reply`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": input.idempotencyKey
          },
          body: JSON.stringify({ comment: input.content }),
          signal: AbortSignal.timeout(30_000)
        }
      );
    } catch {
      return unknownResult(input.draftId);
    }
    if (!response.ok) {
      throw unavailable(
        response.status === 429 ? "rate_limited" : "http_error",
        response.status
      );
    }
    return {
      draft_id: input.draftId,
      provider: this.provider,
      status: "sent",
      provider_message_id: null,
      sent_at: new Date().toISOString()
    };
  }

  private mapMessage(
    message: GraphMessage,
    accountId: string
  ): InboxEvent {
    return {
      provider: this.provider,
      account_id: accountId,
      conversation_id: message.conversationId ?? null,
      conversation_type: "direct",
      conversation_name: "Outlook 邮件会话",
      provider_message_id: message.id,
      sender:
        message.from?.emailAddress?.address ?? "unknown@outlook.invalid",
      sender_ref: null,
      recipients: (message.toRecipients ?? [])
        .map((recipient) => recipient.emailAddress?.address)
        .filter((address): address is string => Boolean(address)),
      subject: message.subject ?? null,
      content: message.bodyPreview || "(无正文预览)",
      received_at:
        message.receivedDateTime ?? new Date(0).toISOString(),
      coverage: {
        source: "official_api",
        complete: false,
        note: "当前内容来自 Microsoft Graph bodyPreview"
      }
    };
  }

  private assertAccount(accountId: string): void {
    if (accountId !== this.config.accountId) {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "Outlook 账号不匹配。",
        statusCode: 400
      });
    }
  }
}

function graphDeltaUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidCheckpoint();
  }
  const deltaPath =
    /^\/v1\.0\/me\/mailFolders(?:\/[^/]+|\([^)]*\))\/messages\/delta$/iu;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "graph.microsoft.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !deltaPath.test(url.pathname)
  ) {
    throw invalidCheckpoint();
  }
  return url.toString();
}

function invalidCheckpoint(): AppError {
  return new AppError({
    code: "INVALID_REQUEST",
    message: "Outlook 增量同步 checkpoint 无效。",
    statusCode: 400,
    details: { provider: "outlook", reason: "invalid_checkpoint" }
  });
}

function unavailable(reason: string, status?: number): AppError {
  return new AppError({
    code: "INBOX_PROVIDER_UNAVAILABLE",
    message: "Outlook 暂时不可用。",
    statusCode: 503,
    retryable: true,
    details: {
      provider: "outlook",
      reason,
      ...(status === undefined ? {} : { status })
    }
  });
}

function unknownResult(draftId: string): InboxSendResult {
  return {
    draft_id: draftId,
    provider: "outlook",
    status: "unknown",
    provider_message_id: null,
    sent_at: null
  };
}
