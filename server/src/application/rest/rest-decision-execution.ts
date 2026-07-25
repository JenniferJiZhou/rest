import {
  CONTRACT_VERSION,
  restSuggestionSchema,
  usageSummarySchema,
  type RestSuggestion,
  type UsageSummary
} from "../../domain/contracts.js";
import { AppError } from "../../domain/errors.js";
import type {
  ProviderCallOptions,
  RestContentRepository,
  RestDecisionCandidate,
  RestDecisionContext,
  RestDecisionProvider
} from "../../domain/ports.js";
import {
  ProviderCallAbortedError,
  withProviderTimeout
} from "../../infra/provider-call.js";
import { restDecisionCandidateSchema } from "../../agent/rest-decision/rest-decision-output.js";

export type RestDecisionExecutionState =
  | "received"
  | "contract_validating"
  | "semantic_validating"
  | "normalizing"
  | "policy_precheck"
  | "provider_deciding"
  | "output_validating"
  | "quest_resolving"
  | "no_offer"
  | "offer"
  | "responded"
  | "rejected"
  | "provider_unavailable";

export type RestDecisionExecutionResult =
  | {
      kind: "responded";
      response: RestSuggestion;
      states: RestDecisionExecutionState[];
    }
  | {
      kind: "rejected";
      error: AppError;
      states: RestDecisionExecutionState[];
    }
  | {
      kind: "provider_unavailable";
      error: AppError;
      states: RestDecisionExecutionState[];
    };

export interface RestDecisionExecutorOptions {
  timeoutMs?: number;
}

export class RestDecisionExecutor {
  constructor(
    private readonly provider: RestDecisionProvider,
    private readonly content: RestContentRepository,
    private readonly options: RestDecisionExecutorOptions = {}
  ) {}

  async execute(
    input: unknown,
    verifiedRequestId: string,
    callOptions?: ProviderCallOptions
  ): Promise<RestDecisionExecutionResult> {
    const states: RestDecisionExecutionState[] = ["received"];
    let request: UsageSummary;
    try {
      states.push("contract_validating");
      request = usageSummarySchema.parse(input);
      states.push("semantic_validating");
      if (request.request_id !== verifiedRequestId) {
        throw invalidRequest(
          "正文 request_id 必须与 X-Request-ID 相同。"
        );
      }
    } catch (error) {
      states.push("rejected");
      return {
        kind: "rejected",
        error: contractError(error),
        states
      };
    }

    states.push("normalizing");
    const context = normalizeParsedContext(request);
    states.push("policy_precheck");

    let candidate: unknown;
    if (
      !isManual(context.source.triggerSource) &&
      context.minutesSinceLastRest < 15
    ) {
      candidate = {
        shouldOfferRest: false,
        reasonCode: "cooldown",
        message: "",
        defaultQuestId: null
      };
    } else {
      states.push("provider_deciding");
      try {
        if ((await this.provider.health()) === "unavailable") {
          throw new Error("provider unavailable");
        }
        candidate = await withProviderTimeout({
          ...(callOptions?.signal
            ? { signal: callOptions.signal }
            : {}),
          timeoutMs: this.options.timeoutMs ?? 3_500,
          timeoutError: restDecisionTimeoutError,
          operation: (signal) =>
            this.provider.decide(context, { signal })
        });
      } catch (error) {
        states.push("provider_unavailable");
        return {
          kind: "provider_unavailable",
          error: providerFailure(error),
          states
        };
      }
    }

    try {
      states.push("output_validating");
      const validated = validateCandidate(candidate, context);
      states.push("quest_resolving");
      const response = resolveResponse(
        validated,
        context,
        this.content
      );
      states.push(
        response.should_offer_rest ? "offer" : "no_offer",
        "responded"
      );
      return { kind: "responded", response, states };
    } catch (error) {
      states.push("rejected");
      return {
        kind: "rejected",
        error:
          error instanceof AppError
            ? error
            : invalidProviderOutput(),
        states
      };
    }
  }
}

function restDecisionTimeoutError(): AppError {
  return new AppError({
    code: "LLM_TIMEOUT",
    message: "休息建议服务响应超时。",
    statusCode: 503,
    retryable: true,
    fallback: "LOCAL_RULES",
    details: { reason: "timeout", operation: "rest_decision" }
  });
}

function providerFailure(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof ProviderCallAbortedError) {
    return new AppError({
      code: "INTERNAL_ERROR",
      message: "休息建议请求已取消。",
      statusCode: 503,
      retryable: true,
      fallback: "LOCAL_RULES",
      details: { reason: "aborted" },
      cause: error
    });
  }
  return new AppError({
    code: "INTERNAL_ERROR",
    message: "休息建议服务暂时不可用。",
    statusCode: 503,
    retryable: true,
    fallback: "LOCAL_RULES",
    details: { reason: "REST_DECISION_PROVIDER_UNAVAILABLE" },
    cause: error
  });
}

export function normalizeRestDecisionContext(
  input: unknown
): RestDecisionContext {
  return normalizeParsedContext(usageSummarySchema.parse(input));
}

function normalizeParsedContext(
  request: UsageSummary
): RestDecisionContext {
  const sourceFormat =
    request.continuous_screen_minutes !== undefined
      ? "legacy"
      : "current";
  const website = request.trigger_source === "macos_website_checkpoint";
  const continuous =
    sourceFormat === "legacy"
      ? request.continuous_screen_minutes ?? 0
      : website
        ? request.continuous_usage_minutes ?? 0
        : request.trigger_source === "macos_usage_checkpoint"
          ? request.continuous_app_usage_minutes ?? 0
          : request.estimated_continuous_app_usage_minutes ?? 0;
  const daily =
    sourceFormat === "legacy"
      ? null
      : website
        ? request.daily_usage_minutes ?? null
        : request.daily_app_usage_minutes ?? null;
  const label = request.user_provided_context_label ?? null;

  return {
    requestId: request.request_id,
    measuredAt: request.measured_at,
    source: {
      platform: request.platform,
      triggerSource: request.trigger_source,
      targetType: website ? "website" : "app"
    },
    monitoredContext: {
      userProvidedLabel: label,
      labelSource:
        label !== null && !website
          ? "user"
          : website
            ? request.label_source ?? null
            : null,
      rawAppIdentityAvailable: false,
      websiteDomain: request.website_domain ?? null,
      fullUrlAvailable: false,
      pageTitleAvailable: false
    },
    usage: {
      dailyMinutes: daily,
      continuousMinutes: continuous,
      continuousIsEstimated:
        sourceFormat === "current"
          ? request.continuous_usage_is_estimated ?? false
          : false
    },
    appSwitchesLast10Minutes:
      request.app_switches_last_10_minutes ?? null,
    localHour: request.local_hour,
    minutesSinceLastRest: request.minutes_since_last_rest,
    selfReportedEnergy: request.self_reported_energy ?? null,
    recentFeedback: request.recent_feedback,
    outputConstraints: {
      maximumMessageCharacters: 240,
      mayControlDevice: false,
      mayChangeNextThreshold: false
    }
  };
}

function validateCandidate(
  input: unknown,
  context: RestDecisionContext
): RestDecisionCandidate {
  const candidate = restDecisionCandidateSchema.parse(input);
  const message = candidate.message;
  const prohibited = [
    /诊断|患有|失眠症|焦虑症|diagnos(?:e|ed|is)|you have insomnia/iu,
    /真实\s*App|Bundle\s*ID|读取了.*App|正在使用的.*App|read.*app identity/iu,
    /https?:\/\/|完整\s*URL|full\s*url/iu,
    /精确连续|已经连续使用|exact continuous/iu,
    /关闭\s*App|屏蔽|Shield|修改.*threshold|change.*threshold/iu,
    /下一次.*(?:checkpoint|检查点)|next\s*checkpoint|checkpoint.*(?:修改|改到|设为|安排)/iu,
    /太懒|没用|道德失败|生产力|productivity|moral failure|lazy/iu
  ];
  if (prohibited.some((pattern) => pattern.test(message))) {
    throw invalidProviderOutput();
  }
  if (
    context.usage.continuousIsEstimated &&
    (
      /精确.*连续|exact.*continuous/iu.test(message) ||
      /(?:持续|连续).{0,12}(?:\d+|[一二三四五六七八九十百两]+)\s*(?:分钟|分)/u.test(
        message
      ) ||
      /(?:continuous|straight).{0,12}\d+\s*minutes?/iu.test(
        message
      )
    )
  ) {
    throw invalidProviderOutput();
  }
  if (!candidate.shouldOfferRest && message !== "") {
    throw invalidProviderOutput();
  }
  if (
    !candidate.shouldOfferRest &&
    !["cooldown", "insufficient_signal"].includes(
      candidate.reasonCode
    )
  ) {
    throw invalidProviderOutput();
  }
  if (!candidate.shouldOfferRest && candidate.defaultQuestId) {
    throw invalidProviderOutput();
  }
  if (candidate.shouldOfferRest && message.trim().length === 0) {
    throw invalidProviderOutput();
  }
  return {
    shouldOfferRest: candidate.shouldOfferRest,
    reasonCode: candidate.reasonCode,
    message: candidate.message,
    defaultQuestId: candidate.defaultQuestId
  };
}

function resolveResponse(
  candidate: RestDecisionCandidate,
  context: RestDecisionContext,
  content: RestContentRepository
): RestSuggestion {
  const questId = candidate.defaultQuestId ?? null;
  if (
    candidate.shouldOfferRest &&
    (!questId || !content.questById(questId))
  ) {
    throw invalidProviderOutput();
  }
  return restSuggestionSchema.parse({
    schema_version: CONTRACT_VERSION,
    request_id: context.requestId,
    should_offer_rest: candidate.shouldOfferRest,
    reason_code: candidate.reasonCode,
    message: candidate.message ?? "",
    default_quest_id: candidate.shouldOfferRest ? questId : null,
    actions: candidate.shouldOfferRest
      ? [
          "start_rest_session",
          "open_check_in",
          "remind_later",
          "dismiss"
        ]
      : ["dismiss"]
  });
}

function contractError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return invalidRequest("请求格式不符合契约。");
}

function invalidRequest(message: string): AppError {
  return new AppError({
    code: "INVALID_REQUEST",
    message,
    statusCode: 400,
    retryable: false
  });
}

function invalidProviderOutput(): AppError {
  return new AppError({
    code: "LLM_INVALID_OUTPUT",
    message: "休息建议输出不符合安全约束。",
    statusCode: 503,
    retryable: true,
    fallback: "LOCAL_RULES",
    details: { reason: "invalid_schema" }
  });
}

function isManual(triggerSource: string): boolean {
  return [
    "manual_ios",
    "manual_macos",
    "notification",
    "debug"
  ].includes(triggerSource);
}
