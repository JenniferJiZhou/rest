import { AppError } from "../domain/errors.js";
import type { ProviderCallOptions } from "../domain/ports.js";
import type {
  InboxIntelligenceProvider,
  InboxSummaryInput,
  ReplyDraftInput,
  ReplyDraftResult
} from "./ports.js";

export class FixtureInboxIntelligenceProvider
  implements InboxIntelligenceProvider
{
  readonly dataOrigin = "mock" as const;

  async health(): Promise<"ready"> {
    return "ready";
  }

  async summarize(
    input: InboxSummaryInput,
    options?: ProviderCallOptions
  ) {
    assertNotAborted(options);
    const topic = input.subject ?? input.content.slice(0, 40);
    return {
      summary: `${input.sender} 发来关于“${topic}”的信息，需要查看并处理。`,
      important_points: [input.content.slice(0, 200)],
      todos: ["查看信息并决定回复内容"],
      priority: "normal" as const,
      needs_reply: true
    };
  }

  async draftReply(
    _input: ReplyDraftInput,
    options?: ProviderCallOptions
  ): Promise<ReplyDraftResult> {
    assertNotAborted(options);
    return {
      content: "收到，我会查看并尽快回复。",
      contentType: "text"
    };
  }
}

export class UnavailableInboxIntelligenceProvider
  implements InboxIntelligenceProvider
{
  readonly dataOrigin = "mock" as const;

  async health(): Promise<"unavailable"> {
    return "unavailable";
  }

  async summarize(
    _input: InboxSummaryInput,
    options?: ProviderCallOptions
  ): Promise<never> {
    assertNotAborted(options);
    throw unavailableError();
  }

  async draftReply(
    _input: ReplyDraftInput,
    options?: ProviderCallOptions
  ): Promise<never> {
    assertNotAborted(options);
    throw unavailableError();
  }
}

function unavailableError(): AppError {
  return new AppError({
    code: "INBOX_AI_UNAVAILABLE",
    message: "摘要与草稿服务暂时不可用。",
    statusCode: 503,
    retryable: true
  });
}

function assertNotAborted(options?: ProviderCallOptions): void {
  if (options?.signal?.aborted) {
    throw unavailableError();
  }
}
