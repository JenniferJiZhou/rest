import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../domain/errors.js";
import type {
  DraftRequest,
  DraftResult,
  DataOrigin,
  HandoffCompletionSink,
  HandoffJobRecord,
  InboundMessage,
  InboundMessageMapper,
  MailFetchContext,
  MailItem,
  MailProvider,
  MessagingChannel,
  OutboundMessage,
  ProviderCallOptions,
  ProviderHealth
} from "../domain/ports.js";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

export class UnavailableMailProvider implements MailProvider {
  readonly dataOrigin: DataOrigin = "mock";

  async health(): Promise<ProviderHealth> {
    return "unavailable";
  }

  async fetchUnread(
    _context: MailFetchContext,
    options?: ProviderCallOptions
  ): Promise<MailItem[]> {
    assertNotAborted(
      options,
      "GMAIL_UNAVAILABLE",
      "OPEN_LOOPS_ONLY"
    );
    throw new AppError({
      code: "GMAIL_NOT_CONNECTED",
      message: "Gmail 尚未连接。",
      statusCode: 503,
      retryable: true,
      fallback: "OPEN_LOOPS_ONLY"
    });
  }

  async createDraft(
    _request: DraftRequest,
    options?: ProviderCallOptions
  ): Promise<DraftResult> {
    assertNotAborted(options, "GMAIL_DRAFT_FAILED", "SUMMARY_ONLY");
    throw new AppError({
      code: "GMAIL_NOT_CONNECTED",
      message: "Gmail 尚未连接。",
      statusCode: 503,
      retryable: true,
      fallback: "SUMMARY_ONLY"
    });
  }
}

export class FixtureMailProvider implements MailProvider {
  readonly dataOrigin: DataOrigin = "mock";
  private readonly items: MailItem[];
  private readonly drafts = new Map<string, DraftResult>();

  constructor(path?: string) {
    const fixturePath =
      path ??
      resolve(
        sourceDirectory,
        "../../../contracts/fixtures/mail-items-demo.json"
      );
    this.items = JSON.parse(readFileSync(fixturePath, "utf8")) as MailItem[];
  }

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async fetchUnread(
    _context: MailFetchContext,
    options?: ProviderCallOptions
  ): Promise<MailItem[]> {
    assertNotAborted(
      options,
      "GMAIL_UNAVAILABLE",
      "OPEN_LOOPS_ONLY"
    );
    return structuredClone(this.items);
  }

  async createDraft(
    request: DraftRequest,
    options?: ProviderCallOptions
  ): Promise<DraftResult> {
    assertNotAborted(options, "GMAIL_DRAFT_FAILED", "SUMMARY_ONLY");
    const existing = this.drafts.get(request.dedupeKey);
    if (existing) {
      return structuredClone(existing);
    }
    const result = { draftId: `fixture-draft-${this.drafts.size + 1}` };
    this.drafts.set(request.dedupeKey, result);
    return structuredClone(result);
  }
}

export class NoopHandoffCompletionSink
  implements HandoffCompletionSink
{
  readonly dataOrigin: DataOrigin = "mock";

  async notify(
    _record: HandoffJobRecord,
    options?: ProviderCallOptions
  ): Promise<void> {
    assertNotAborted(options, "PHOTON_UNAVAILABLE", "APP_ONLY");
    // W2 supplies the Photon-backed implementation.
  }
}

export class MessagingHandoffCompletionSink
  implements HandoffCompletionSink
{
  constructor(
    private readonly channel: MessagingChannel,
    private readonly recipientId: string
  ) {}

  get dataOrigin(): DataOrigin {
    return this.channel.dataOrigin === "real" ? "real" : "mock";
  }

  async notify(
    record: HandoffJobRecord,
    options?: ProviderCallOptions
  ): Promise<void> {
    assertNotAborted(options, "PHOTON_UNAVAILABLE", "APP_ONLY");
    const receipt = record.state.summary?.pause_receipt;
    if (!receipt) {
      return;
    }
    const nextStep = receipt.tomorrow_first_step
      ? `\n明天第一步：${receipt.tomorrow_first_step}`
      : "";
    await this.channel.send(
      {
        recipientId: this.recipientId,
        text: `${receipt.conclusion}${nextStep}`,
        correlationId: record.job.job_id
      },
      options
    );
  }
}

export class RecordingMessagingChannel implements MessagingChannel {
  readonly dataOrigin: DataOrigin = "mock";
  private readonly messages: OutboundMessage[] = [];

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async send(
    message: OutboundMessage,
    options?: ProviderCallOptions
  ): Promise<void> {
    if (options?.signal?.aborted) {
      throw new AppError({
        code: "PHOTON_UNAVAILABLE",
        message: "消息发送已取消。",
        statusCode: 503,
        retryable: true,
        fallback: "APP_ONLY",
        details: { reason: "aborted" }
      });
    }
    this.messages.push(structuredClone(message));
  }

  sent(): OutboundMessage[] {
    return structuredClone(this.messages);
  }
}

export class ConsoleMessagingChannel implements MessagingChannel {
  readonly dataOrigin: DataOrigin = "mock";

  constructor(
    private readonly writer: (line: string) => void = console.info
  ) {}

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async send(
    message: OutboundMessage,
    options?: ProviderCallOptions
  ): Promise<void> {
    if (options?.signal?.aborted) {
      throw new AppError({
        code: "PHOTON_UNAVAILABLE",
        message: "消息发送已取消。",
        statusCode: 503,
        retryable: true,
        fallback: "APP_ONLY",
        details: { reason: "aborted" }
      });
    }
    this.writer(
      JSON.stringify({
        provider: "console",
        recipient_id: message.recipientId,
        correlation_id: message.correlationId,
        text_length: message.text.length
      })
    );
  }
}

export class UnavailableMessagingChannel implements MessagingChannel {
  readonly dataOrigin: DataOrigin = "mock";

  async health(): Promise<ProviderHealth> {
    return "unavailable";
  }

  async send(
    _message: OutboundMessage,
    options?: ProviderCallOptions
  ): Promise<void> {
    assertNotAborted(options, "PHOTON_UNAVAILABLE", "APP_ONLY");
    throw new AppError({
      code: "PHOTON_UNAVAILABLE",
      message: "消息渠道暂时不可用。",
      statusCode: 503,
      retryable: true,
      fallback: "APP_ONLY"
    });
  }
}

function assertNotAborted(
  options: ProviderCallOptions | undefined,
  code:
    | "GMAIL_UNAVAILABLE"
    | "GMAIL_DRAFT_FAILED"
    | "PHOTON_UNAVAILABLE",
  fallback: "OPEN_LOOPS_ONLY" | "SUMMARY_ONLY" | "APP_ONLY"
): void {
  if (!options?.signal?.aborted) {
    return;
  }
  throw new AppError({
    code,
    message: "Provider operation was aborted.",
    statusCode: 503,
    retryable: true,
    fallback,
    details: { reason: "aborted" }
  });
}

export class NormalizedInboundMessageMapper
  implements InboundMessageMapper<InboundMessage>
{
  map(payload: InboundMessage): InboundMessage {
    const required = [
      payload.eventId,
      payload.providerMessageId,
      payload.senderId,
      payload.recipientId,
      payload.receivedAt
    ];
    if (
      required.some((value) => value.length === 0) ||
      Number.isNaN(Date.parse(payload.receivedAt))
    ) {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "入站消息无法映射为标准事件。",
        statusCode: 400,
        retryable: false
      });
    }
    return structuredClone(payload);
  }
}
