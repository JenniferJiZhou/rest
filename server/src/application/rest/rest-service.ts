import {
  CONTENT_VERSION,
  fatigueCheckInSchema,
  fatigueReflectionSchema,
  restFeedbackSchema,
  restQuestRecommendationSchema,
  restRecommendationRequestSchema,
  restSuggestionSchema,
  usageSummarySchema,
  type FatigueCheckIn,
  type FatigueReflection,
  type RestFeedback,
  type RestQuest,
  type RestQuestRecommendation,
  type RestRecommendationRequest,
  type RestSuggestion
} from "../../domain/contracts.js";
import { AppError } from "../../domain/errors.js";
import { canonicalRequestHash } from "../../domain/request-hash.js";
import type {
  AgentLLM,
  FeedbackRepository,
  IdempotencyStore,
  RestContentRepository,
  RestDecisionProvider
} from "../../domain/ports.js";
import { withProviderTimeout } from "../../infra/provider-call.js";
import { RestDecisionExecutor } from "./rest-decision-execution.js";

export interface RestServiceOptions {
  llmTimeoutMs?: number;
}

export class RestService {
  private readonly decisionExecutor: RestDecisionExecutor;

  constructor(
    private readonly agent: AgentLLM,
    private readonly content: RestContentRepository,
    private readonly feedback: FeedbackRepository,
    private readonly idempotency: IdempotencyStore<unknown>,
    decisionProvider: RestDecisionProvider,
    private readonly options: RestServiceOptions = {}
  ) {
    this.decisionExecutor = new RestDecisionExecutor(
      decisionProvider,
      content
    );
  }

  async evaluate(
    input: unknown,
    verifiedRequestId: string
  ): Promise<RestSuggestion> {
    const request = usageSummarySchema.parse(input);
    if (request.request_id !== verifiedRequestId) {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "正文 request_id 必须与 X-Request-ID 相同。",
        statusCode: 400,
        retryable: false
      });
    }
    await this.idempotency.deleteExpired(new Date().toISOString());
    const claim = await this.idempotency.claimOrGet({
      key: `rest:evaluate:${verifiedRequestId}`,
      requestHash: canonicalRequestHash(request),
      ttlSeconds: 24 * 60 * 60,
      create: async () => {
        const result = await this.decisionExecutor.execute(
          request,
          verifiedRequestId
        );
        if (result.kind === "responded") {
          return result.response;
        }
        throw result.error;
      }
    });
    if (claim.kind === "conflict_different_request") {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "该 request_id 已用于不同的请求内容。",
        statusCode: 409,
        retryable: false,
        details: { reason: "REQUEST_ID_REUSED" }
      });
    }
    return restSuggestionSchema.parse(claim.value);
  }

  async checkIn(input: FatigueCheckIn): Promise<FatigueReflection> {
    const request = fatigueCheckInSchema.parse(input);
    const result = fatigueReflectionSchema.parse(
      await withProviderTimeout({
        timeoutMs: this.options.llmTimeoutMs ?? 15_000,
        timeoutError: () => this.llmTimeoutError("reflect_fatigue"),
        operation: (signal) =>
          this.agent.reflectFatigue(request, { signal })
      })
    );
    if (request.follow_up_answer && result.needs_follow_up) {
      throw new AppError({
        code: "LLM_INVALID_OUTPUT",
        message: "模型违反了一次追问限制。",
        statusCode: 503,
        retryable: true,
        fallback: "LOCAL_REFLECTION"
      });
    }
    return result;
  }

  async recommend(
    input: RestRecommendationRequest
  ): Promise<RestQuestRecommendation> {
    const request = restRecommendationRequestSchema.parse(input);
    if (
      request.content_version !== this.content.contentVersion() ||
      request.content_version !== CONTENT_VERSION
    ) {
      throw new AppError({
        code: "CONTENT_VERSION_MISMATCH",
        message: "客户端休息内容版本与服务器不一致。",
        statusCode: 409,
        retryable: false,
        fallback: "BUNDLED_CONTENT",
        details: {
          requested: request.content_version,
          available: this.content.contentVersion()
        }
      });
    }

    const eligible = this.eligibleQuests(request);
    if (eligible.length === 0) {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "当前约束下没有可用的休息任务。",
        statusCode: 400,
        retryable: false,
        fallback: "LOCAL_QUEST"
      });
    }

    const recommendation = restQuestRecommendationSchema.parse(
      await withProviderTimeout({
        timeoutMs: this.options.llmTimeoutMs ?? 15_000,
        timeoutError: () => this.llmTimeoutError("choose_quest"),
        operation: (signal) =>
          this.agent.chooseQuest(request, eligible, { signal })
      })
    );
    if (!eligible.some((quest) => quest.id === recommendation.quest_id)) {
      throw new AppError({
        code: "LLM_INVALID_OUTPUT",
        message: "模型选择了固定内容库之外的任务。",
        statusCode: 503,
        retryable: true,
        fallback: eligible[0]?.id ?? "LOCAL_QUEST"
      });
    }
    return recommendation;
  }

  async recordFeedback(
    input: RestFeedback,
    idempotencyKey: string
  ): Promise<void> {
    const feedback = restFeedbackSchema.parse(input);
    await this.idempotency.deleteExpired(
      new Date().toISOString()
    );
    const result = await this.idempotency.claimOrGet({
      key: `rest:feedback:${idempotencyKey}`,
      requestHash: canonicalRequestHash(feedback),
      ttlSeconds: 24 * 60 * 60,
      create: async () => {
        await this.feedback.record(feedback);
        return true;
      }
    });
    if (result.kind === "conflict_different_request") {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "该 Idempotency-Key 已用于不同的反馈内容。",
        statusCode: 409,
        retryable: false,
        details: {
          reason: "IDEMPOTENCY_KEY_REUSED"
        }
      });
    }
  }

  private eligibleQuests(
    request: RestRecommendationRequest
  ): RestQuest[] {
    const allowed = new Set(request.allowed_quest_ids);
    const excluded = new Set(request.excluded_quest_ids);
    const maximumDuration = request.available_minutes * 60;

    return this.content.quests().filter((quest) => {
      const isExplicitlyAllowed =
        allowed.size === 0 || allowed.has(quest.id);
      const locationMatches =
        request.location_tags.length === 0 ||
        quest.location_tags.includes("any") ||
        quest.location_tags.some((tag) =>
          request.location_tags.includes(tag)
        );
      return (
        isExplicitlyAllowed &&
        !excluded.has(quest.id) &&
        quest.duration_seconds <= maximumDuration &&
        locationMatches &&
        (quest.fatigue_types.includes(request.fatigue_type) ||
          request.fatigue_type === "unknown")
      );
    });
  }

  private llmTimeoutError(operation: string): AppError {
    return new AppError({
      code: "LLM_TIMEOUT",
      message: "Model provider timed out.",
      statusCode: 503,
      retryable: true,
      fallback: "LOCAL_RULES",
      details: { reason: "timeout", operation }
    });
  }

}
