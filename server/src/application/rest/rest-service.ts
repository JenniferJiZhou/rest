import {
  CONTENT_VERSION,
  CONTRACT_VERSION,
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
  type RestSuggestion,
  type UsageSummary
} from "../../domain/contracts.js";
import { AppError } from "../../domain/errors.js";
import { canonicalRequestHash } from "../../domain/request-hash.js";
import type {
  AgentLLM,
  FeedbackRepository,
  IdempotencyStore,
  RestContentRepository
} from "../../domain/ports.js";
import { withProviderTimeout } from "../../infra/provider-call.js";

export interface RestServiceOptions {
  llmTimeoutMs?: number;
}

export class RestService {
  constructor(
    private readonly agent: AgentLLM,
    private readonly content: RestContentRepository,
    private readonly feedback: FeedbackRepository,
    private readonly feedbackIdempotency: IdempotencyStore<boolean>,
    private readonly options: RestServiceOptions = {}
  ) {}

  evaluate(input: UsageSummary): RestSuggestion {
    const request = usageSummarySchema.parse(input);
    const manual = [
      "manual_ios",
      "manual_macos",
      "notification",
      "debug"
    ].includes(request.trigger_source);

    if (!manual && request.minutes_since_last_rest < 15) {
      return this.suggestion(request.request_id, false, "cooldown", "");
    }
    if (manual) {
      return this.suggestion(
        request.request_id,
        true,
        "manual",
        "可以。先说说你现在更像是哪一种累。"
      );
    }
    if (
      request.self_reported_energy !== null &&
      request.self_reported_energy !== undefined &&
      request.self_reported_energy <= 2
    ) {
      return this.suggestion(
        request.request_id,
        true,
        "low_energy",
        "你的精力已经偏低，先做一个短而明确的恢复动作。"
      );
    }
    if (request.local_hour >= 23 || request.local_hour <= 5) {
      return this.suggestion(
        request.request_id,
        true,
        "late_hour",
        "现在已经很晚，先把未完成事项安置好，再决定是否继续。"
      );
    }
    if ((request.app_switches_last_10_minutes ?? 0) >= 10) {
      return this.suggestion(
        request.request_id,
        true,
        "attention_fragmentation",
        "刚才的应用切换比较频繁，先离开屏幕一小会儿。"
      );
    }
    if ((request.continuous_screen_minutes ?? 0) >= 45) {
      return this.suggestion(
        request.request_id,
        true,
        "long_continuous_use",
        "你已经连续使用屏幕一段时间，可以先暂停几分钟。"
      );
    }
    return this.suggestion(
      request.request_id,
      false,
      "insufficient_signal",
      ""
    );
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
    await this.feedbackIdempotency.deleteExpired(
      new Date().toISOString()
    );
    const result = await this.feedbackIdempotency.claimOrGet({
      key: idempotencyKey,
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

  private suggestion(
    requestId: string,
    shouldOffer: boolean,
    reasonCode: RestSuggestion["reason_code"],
    message: string
  ): RestSuggestion {
    return restSuggestionSchema.parse({
      schema_version: CONTRACT_VERSION,
      request_id: requestId,
      should_offer_rest: shouldOffer,
      reason_code: reasonCode,
      message,
      default_quest_id: shouldOffer
        ? this.content.quests()[0]?.id ?? null
        : null,
      actions: shouldOffer
        ? ["start_rest_session", "open_check_in", "remind_later", "dismiss"]
        : []
    });
  }
}
