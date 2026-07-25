import {
  CONTENT_VERSION,
  CONTRACT_VERSION,
  DYNAMIC_REST_CONTRACT_VERSION,
  fatigueCheckInSchema,
  fatigueReflectionSchema,
  dynamicRestTaskRecommendationSchema,
  restFeedbackSchema,
  restQuestRecommendationSchema,
  restRecommendationRequestV1Schema,
  restRecommendationRequestV1_1Schema,
  restSuggestionV1Schema,
  restSuggestionV1_1Schema,
  usageSummarySchema,
  type FatigueCheckIn,
  type FatigueReflection,
  type RestFeedback,
  type RestQuest,
  type RestQuestRecommendation,
  type RestRecommendation,
  type RestRecommendationRequestV1,
  type RestRecommendationRequestV1_1,
  type RestSuggestion,
  type UsageSummary
} from "../../domain/contracts.js";
import { AppError } from "../../domain/errors.js";
import { canonicalRequestHash } from "../../domain/request-hash.js";
import type {
  AgentLLM,
  DynamicManualRestCandidate,
  DynamicManualRestContext,
  DynamicManualRestProvider,
  DynamicRestDecisionCandidate,
  FeedbackRepository,
  IdempotencyStore,
  ProviderCallOptions,
  RestContentRepository,
  RestDecisionProvider
} from "../../domain/ports.js";
import { withProviderTimeout } from "../../infra/provider-call.js";
import {
  dynamicManualRestCandidateSchema
} from "../../agent/rest-decision/dynamic-rest-decision-output.js";
import { DynamicRestDecisionExecutor } from "./dynamic-rest-decision-execution.js";
import { RestDecisionExecutor } from "./rest-decision-execution.js";

export interface RestServiceOptions {
  llmTimeoutMs?: number;
  restDecisionTimeoutMs?: number;
  dynamicRestDecisionTimeoutMs?: number;
  dynamicDecisionProvider?: RestDecisionProvider<DynamicRestDecisionCandidate>;
  dynamicManualRestProvider?: DynamicManualRestProvider;
}

export interface RestEvaluationOptions extends ProviderCallOptions {
  contractVersion?: RestEvaluationContractVersion;
}

export interface RestRecommendationOptions extends ProviderCallOptions {
  contractVersion?: RestContractVersion;
}

export type RestContractVersion =
  | typeof CONTRACT_VERSION
  | typeof DYNAMIC_REST_CONTRACT_VERSION;
export type RestEvaluationContractVersion = RestContractVersion;

export class RestService {
  private readonly decisionExecutor: RestDecisionExecutor;
  private readonly dynamicDecisionExecutor:
    | DynamicRestDecisionExecutor
    | null;
  private readonly dynamicManualRestProvider:
    | DynamicManualRestProvider
    | null;

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
      content,
      options.restDecisionTimeoutMs === undefined
        ? {}
        : { timeoutMs: options.restDecisionTimeoutMs }
    );
    this.dynamicDecisionExecutor = options.dynamicDecisionProvider
      ? new DynamicRestDecisionExecutor(
          options.dynamicDecisionProvider,
          options.dynamicRestDecisionTimeoutMs === undefined
            ? {}
            : { timeoutMs: options.dynamicRestDecisionTimeoutMs }
      )
      : null;
    this.dynamicManualRestProvider =
      options.dynamicManualRestProvider ?? null;
  }

  async evaluate(
    input: unknown,
    verifiedRequestId: string,
    options?: RestEvaluationOptions
  ): Promise<RestSuggestion> {
    const contractVersion =
      options?.contractVersion ?? CONTRACT_VERSION;
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
      key: `rest:evaluate:${contractVersion}:${verifiedRequestId}`,
      requestHash: canonicalRequestHash(request),
      ttlSeconds: 24 * 60 * 60,
      create: async () => {
        const result =
          contractVersion === DYNAMIC_REST_CONTRACT_VERSION
            ? await this.executeDynamicDecision(
                request,
                verifiedRequestId,
                options
              )
            : await this.decisionExecutor.execute(
                request,
                verifiedRequestId,
                options
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
    return contractVersion === DYNAMIC_REST_CONTRACT_VERSION
      ? restSuggestionV1_1Schema.parse(claim.value)
      : restSuggestionV1Schema.parse(claim.value);
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
    input: RestRecommendationRequestV1
  ): Promise<RestQuestRecommendation>;
  async recommend(
    input: unknown,
    verifiedRequestId: string,
    options: RestRecommendationOptions
  ): Promise<RestRecommendation>;
  async recommend(
    input: unknown,
    verifiedRequestId?: string,
    options?: RestRecommendationOptions
  ): Promise<RestRecommendation> {
    const contractVersion =
      options?.contractVersion ?? CONTRACT_VERSION;
    const request =
      contractVersion === DYNAMIC_REST_CONTRACT_VERSION
        ? restRecommendationRequestV1_1Schema.parse(input)
        : restRecommendationRequestV1Schema.parse(input);
    const requestId = verifiedRequestId ?? request.request_id;
    if (request.request_id !== requestId) {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "Body request_id must match X-Request-ID.",
        statusCode: 400,
        retryable: false
      });
    }
    await this.idempotency.deleteExpired(new Date().toISOString());
    const claim = await this.idempotency.claimOrGet({
      key: `rest:recommend:${contractVersion}:${requestId}`,
      requestHash: canonicalRequestHash(request),
      ttlSeconds: 24 * 60 * 60,
      create: async () => {
        if (request.schema_version === DYNAMIC_REST_CONTRACT_VERSION) {
          return await this.dynamicManualRecommendation(request, options);
        }
        return await this.legacyQuestRecommendation(request);
      }
    });
    if (claim.kind === "conflict_different_request") {
      throw new AppError({
        code: "INVALID_REQUEST",
        message: "This request_id was already used for different content.",
        statusCode: 409,
        retryable: false,
        details: { reason: "REQUEST_ID_REUSED" }
      });
    }
    return contractVersion === DYNAMIC_REST_CONTRACT_VERSION
      ? dynamicRestTaskRecommendationSchema.parse(claim.value)
      : restQuestRecommendationSchema.parse(claim.value);
  }

  private async legacyQuestRecommendation(
    request: RestRecommendationRequestV1
  ): Promise<RestQuestRecommendation> {
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

  private async dynamicManualRecommendation(
    request: RestRecommendationRequestV1_1,
    options?: RestRecommendationOptions
  ): Promise<RestRecommendation> {
    const provider = this.dynamicManualRestProvider;
    if (provider === null) {
      throw this.dynamicManualRestUnavailable();
    }

    let candidate: DynamicManualRestCandidate;
    try {
      if ((await provider.health()) === "unavailable") {
        throw this.dynamicManualRestUnavailable();
      }
      candidate = dynamicManualRestCandidateSchema.parse(
        await withProviderTimeout({
          ...(options?.signal ? { signal: options.signal } : {}),
          timeoutMs: this.options.dynamicRestDecisionTimeoutMs ?? 30_000,
          timeoutError: () =>
            new AppError({
              code: "LLM_TIMEOUT",
              message: "Dynamic manual rest generation timed out.",
              statusCode: 503,
              retryable: true,
              details: {
                reason: "timeout",
                operation: "manual_rest_dynamic"
              }
            }),
          operation: (signal) =>
            provider.generate(
              this.dynamicManualRestContext(request),
              { signal }
            )
        })
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError({
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          retryable: error.retryable,
          details: error.details,
          cause: error
        });
      }
      throw this.dynamicManualRestUnavailable(error);
    }

    return dynamicRestTaskRecommendationSchema.parse({
      schema_version: DYNAMIC_REST_CONTRACT_VERSION,
      request_id: request.request_id,
      message: candidate.message,
      generated_task: {
        title: candidate.generatedTask.title,
        duration_seconds: candidate.generatedTask.durationSeconds,
        steps: [...candidate.generatedTask.steps]
      },
      default_quest_id: null,
      actions: ["start_rest_session", "remind_later", "dismiss"]
    });
  }

  private dynamicManualRestContext(
    request: RestRecommendationRequestV1_1
  ): DynamicManualRestContext {
    return {
      requestId: request.request_id,
      sessionId: request.session_id,
      fatigueType: request.fatigue_type,
      userPreference: request.user_preference ?? null,
      availableMinutes: request.available_minutes,
      source: request.source,
      locationTags: [...request.location_tags]
    };
  }

  private dynamicManualRestUnavailable(cause?: unknown): AppError {
    return new AppError({
      code: "INTERNAL_ERROR",
      message: "Dynamic manual rest generation is unavailable.",
      statusCode: 503,
      retryable: true,
      details: {
        reason: "REST_DECISION_PROVIDER_UNAVAILABLE"
      },
      cause
    });
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
    request: RestRecommendationRequestV1
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

  private async executeDynamicDecision(
    request: UsageSummary,
    verifiedRequestId: string,
    options?: RestEvaluationOptions
  ) {
    if (this.dynamicDecisionExecutor === null) {
      throw new AppError({
        code: "INTERNAL_ERROR",
        message: "休息建议服务暂时不可用。",
        statusCode: 503,
        retryable: true,
        details: {
          reason: "REST_DECISION_PROVIDER_UNAVAILABLE"
        }
      });
    }
    return this.dynamicDecisionExecutor.execute(
      request,
      verifiedRequestId,
      options
    );
  }

}
