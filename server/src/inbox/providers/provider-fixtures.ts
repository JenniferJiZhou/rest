import { AppError } from "../../domain/errors.js";
import type {
  InboxEvent,
  InboxProvider,
  InboxSendResult
} from "../../domain/contracts.js";
import type {
  InboxParticipantBinding,
  InboxSendInput,
  InboxSender,
  InboxSource
} from "../ports.js";

export class FixtureInboxSource implements InboxSource {
  readonly dataOrigin = "mock" as const;

  constructor(readonly provider: InboxProvider) {}

  async health(): Promise<"ready"> {
    return "ready";
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
    return {
      checkpoint: input.checkpoint ?? `${this.provider}-fixture-1`,
      participantBindings: [],
      items: input.limit < 1 ? [] : [fixtureEvent(this.provider, input.accountId)]
    };
  }
}

export class FixtureInboxSender implements InboxSender {
  readonly dataOrigin = "mock" as const;
  readonly sent: InboxSendInput[] = [];

  constructor(readonly provider: InboxProvider) {}

  async health(): Promise<"ready"> {
    return "ready";
  }

  async send(input: InboxSendInput): Promise<InboxSendResult> {
    this.sent.push(structuredClone(input));
    return {
      draft_id: input.draftId,
      provider: this.provider,
      status: "sent",
      provider_message_id: `${this.provider}-fixture-sent`,
      sent_at: "2026-07-24T02:00:00.000Z"
    };
  }
}

export class UnavailableInboxSource implements InboxSource {
  readonly dataOrigin = "mock" as const;

  constructor(readonly provider: InboxProvider) {}

  async health(): Promise<"unavailable"> {
    return "unavailable";
  }

  async pull(): Promise<never> {
    throw unavailable(this.provider);
  }
}

export class UnavailableInboxSender implements InboxSender {
  readonly dataOrigin = "mock" as const;

  constructor(readonly provider: InboxProvider) {}

  async health(): Promise<"unavailable"> {
    return "unavailable";
  }

  async send(): Promise<never> {
    throw unavailable(this.provider);
  }
}

function fixtureEvent(
  provider: InboxProvider,
  accountId: string
): InboxEvent {
  return {
    provider,
    account_id: accountId,
    conversation_id: `${provider}-fixture-conversation`,
    conversation_type: "direct",
    conversation_name: `${provider} 演示会话`,
    provider_message_id: `${provider}-fixture-message`,
    sender: `${provider}-sender@example.com`,
    sender_ref: null,
    recipients: [accountId],
    subject: `${provider} 演示消息`,
    content: "请确认演示安排并回复。",
    received_at: "2026-07-24T01:00:00.000Z",
    coverage: {
      source: provider === "qq_mail" ? "imap" : "official_api",
      complete: true,
      note: null
    }
  };
}

function unavailable(provider: InboxProvider): AppError {
  return new AppError({
    code: "INBOX_PROVIDER_UNAVAILABLE",
    message: "消息渠道尚未配置。",
    statusCode: 503,
    retryable: true,
    details: { provider }
  });
}
