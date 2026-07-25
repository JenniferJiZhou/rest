import {
  DYNAMIC_REST_CONTRACT_VERSION,
  restSuggestionV1_1Schema,
  usageSummarySchema,
  type RestSuggestion,
  type UsageSummary
} from "../../domain/contracts.js";
import { AppError } from "../../domain/errors.js";
import type {
  DynamicRestDecisionCandidate,
  ProviderCallOptions,
  RestDecisionProvider
} from "../../domain/ports.js";
import {
  ProviderCallAbortedError,
  withProviderTimeout
} from "../../infra/provider-call.js";
import {
  dynamicRestDecisionCandidateSchema
} from "../../agent/rest-decision/dynamic-rest-decision-output.js";
import { normalizeRestDecisionContext } from "./rest-decision-execution.js";

export type DynamicRestDecisionExecutionResult =
  | { kind: "responded"; response: RestSuggestion }
  | { kind: "rejected"; error: AppError }
  | { kind: "provider_unavailable"; error: AppError };

export interface DynamicRestDecisionExecutorOptions {
  timeoutMs?: number;
}

export class DynamicRestDecisionExecutor {
  constructor(
    private readonly provider: RestDecisionProvider<DynamicRestDecisionCandidate>,
    private readonly options: DynamicRestDecisionExecutorOptions = {}
  ) {}

  async execute(
    input: unknown,
    verifiedRequestId: string,
    callOptions?: ProviderCallOptions
  ): Promise<DynamicRestDecisionExecutionResult> {
    let request: UsageSummary;
    try {
      request = usageSummarySchema.parse(input);
      if (request.request_id !== verifiedRequestId) {
        throw invalidRequest(
          "正文 request_id 必须与 X-Request-ID 相同。"
        );
      }
    } catch (error) {
      return {
        kind: "rejected",
        error:
          error instanceof AppError
            ? error
            : invalidRequest("请求格式不符合契约。")
      };
    }

    let candidate: unknown;
    try {
      if ((await this.provider.health()) === "unavailable") {
        throw new Error("provider unavailable");
      }
      candidate = await withProviderTimeout({
        ...(callOptions?.signal
          ? { signal: callOptions.signal }
          : {}),
        timeoutMs: this.options.timeoutMs ?? 30_000,
        timeoutError: dynamicRestDecisionTimeoutError,
        operation: (signal) =>
          this.provider.decide(
            normalizeRestDecisionContext(request),
            { signal }
          )
      });
    } catch (error) {
      return {
        kind: "provider_unavailable",
        error: providerFailure(error)
      };
    }

    try {
      const validated = dynamicRestDecisionCandidateSchema.parse(
        candidate
      );
      return {
        kind: "responded",
        response: mapDynamicResponse(validated, verifiedRequestId)
      };
    } catch {
      return {
        kind: "rejected",
        error: invalidProviderOutput()
      };
    }
  }
}

function mapDynamicResponse(
  candidate: DynamicRestDecisionCandidate,
  requestId: string
): RestSuggestion {
  return restSuggestionV1_1Schema.parse({
    schema_version: DYNAMIC_REST_CONTRACT_VERSION,
    request_id: requestId,
    should_offer_rest: candidate.shouldOfferRest,
    reason_code: candidate.reasonCode,
    message: candidate.message,
    generated_task:
      candidate.generatedTask === null
        ? null
        : {
            title: candidate.generatedTask.title,
            duration_seconds: candidate.generatedTask.durationSeconds,
            steps: [...candidate.generatedTask.steps]
          },
    default_quest_id: null,
    actions: candidate.shouldOfferRest
      ? ["start_rest_session", "remind_later", "dismiss"]
      : []
  });
}

function dynamicRestDecisionTimeoutError(): AppError {
  return new AppError({
    code: "LLM_TIMEOUT",
    message: "休息建议服务响应超时。",
    statusCode: 503,
    retryable: true,
    details: { reason: "timeout", operation: "rest_decision_dynamic" }
  });
}

function providerFailure(error: unknown): AppError {
  if (error instanceof AppError) {
    return new AppError({
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      retryable: error.retryable,
      details: error.details,
      cause: error
    });
  }
  if (error instanceof ProviderCallAbortedError) {
    return new AppError({
      code: "INTERNAL_ERROR",
      message: "休息建议请求已取消。",
      statusCode: 503,
      retryable: true,
      details: { reason: "aborted" },
      cause: error
    });
  }
  return new AppError({
    code: "INTERNAL_ERROR",
    message: "休息建议服务暂时不可用。",
    statusCode: 503,
    retryable: true,
    details: { reason: "REST_DECISION_PROVIDER_UNAVAILABLE" },
    cause: error
  });
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
    message: "休息建议输出不符合契约结构。",
    statusCode: 503,
    retryable: true,
    details: { reason: "invalid_schema" }
  });
}
