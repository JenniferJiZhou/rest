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

  async health(): Promise<"ready" | "unavailable"> {
    return this.config.accountId ? "ready" : "unavailable";
  }

  async pull(input: {
    accountId: string;
    checkpoint: string | null;
    limit: number;
  }): Promise<{ items: InboxEvent[]; checkpoint: string }> {
    this.assertAccount(input.accountId);
    const token = await this.config.accessToken();
    const url =
      input.checkpoint ??
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top=${input.limit}&$select=id,conversationId,from,toRecipients,subject,bodyPreview,receivedDateTime`;
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
    return {
      checkpoint,
      items: (payload.value ?? []).map((message) =>
        this.mapMessage(message, input.accountId)
      )
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
          body: JSON.stringify({ comment: input.content })
        }
      );
    } catch (error) {
      if (isTimeout(error)) {
        return unknownResult(input.draftId);
      }
      throw unavailable("network");
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
      provider_message_id: message.id,
      sender:
        message.from?.emailAddress?.address ?? "unknown@outlook.invalid",
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

function isTimeout(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ETIMEDOUT"
  );
}
