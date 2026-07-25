import type { ErrorCode, ErrorResponse } from "./contracts.js";
import {
  CONTRACT_VERSION,
  DYNAMIC_REST_CONTRACT_VERSION
} from "./contracts.js";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly fallback: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(input: {
    code: ErrorCode;
    message: string;
    statusCode?: number;
    retryable?: boolean;
    fallback?: string | null;
    details?: Record<string, unknown> | null;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "AppError";
    this.code = input.code;
    this.statusCode = input.statusCode ?? 500;
    this.retryable = input.retryable ?? false;
    this.fallback = input.fallback ?? null;
    this.details = input.details ?? null;
  }
}

export function toErrorResponse(
  error: AppError,
  requestId: string,
  contractVersion:
    | typeof CONTRACT_VERSION
    | typeof DYNAMIC_REST_CONTRACT_VERSION = CONTRACT_VERSION
): ErrorResponse {
  return {
    schema_version: contractVersion,
    request_id: requestId,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      fallback: error.fallback,
      details: error.details
    }
  };
}

export function unknownToAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError({
    code: "INTERNAL_ERROR",
    message: "服务暂时不可用。",
    statusCode: 500,
    retryable: true,
    cause: error
  });
}
