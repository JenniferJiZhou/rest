import {
  createHash,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import { ZodError } from "zod";
import type { AppConfig } from "../config.js";
import {
  CONTRACT_VERSION,
  DYNAMIC_REST_CONTRACT_VERSION,
  fatigueCheckInSchema,
  handoffStartRequestSchema,
  restFeedbackSchema
} from "../domain/contracts.js";
import {
  AppError,
  toErrorResponse,
  unknownToAppError
} from "../domain/errors.js";
import type {
  DataOrigin,
  ProviderHealth
} from "../domain/ports.js";
import type { HandoffService } from "../application/handoff/handoff-service.js";
import type { InboxService } from "../application/inbox/inbox-service.js";
import type { RestService } from "../application/rest/rest-service.js";
import type { RestContractVersion } from "../application/rest/rest-service.js";
import { registerInboxRoutes } from "./inbox-routes.js";

export interface ServerDependencies {
  config: AppConfig;
  restDecisionOrigin: DataOrigin;
  manualRestOrigin: DataOrigin;
  legacyRestDecisionOrigin: DataOrigin;
  restDecisionHealth: ProviderHealth;
  restOrigin: DataOrigin;
  handoffOrigin: DataOrigin;
  inboxOrigin: DataOrigin;
  demoRestOrigin: DataOrigin;
  demoHandoffOrigin: DataOrigin;
  demoInboxOrigin: DataOrigin;
  rest: RestService;
  handoff: HandoffService;
  inbox: InboxService;
  demoRest: RestService;
  demoHandoff: HandoffService;
  demoInbox: InboxService;
  providerHealth(): Promise<Record<string, ProviderHealth>>;
}

interface RequestContext {
  requestId: string;
  principalId: string;
  origin: DataOrigin;
  contractVersion: RestContractVersion;
  rest: RestService;
  handoff: HandoffService;
  inbox: InboxService;
}

type GraphKind =
  | "rest_decision"
  | "rest_manual"
  | "rest"
  | "handoff"
  | "inbox";

export function createServer(
  dependencies: ServerDependencies
): FastifyInstance {
  const server = Fastify({
    trustProxy: dependencies.config.TRUST_PROXY,
    bodyLimit: 64 * 1024,
    requestIdHeader: "x-request-id",
    genReqId: () => `req_server_${randomUUID()}`,
    logger: {
      level: dependencies.config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.x-hush-demo-token",
          "req.headers.x-hush-app-session",
          "req.headers.cookie",
          "req.body",
          "res.headers.set-cookie",
          "*.apiKey",
          "*.api_key",
          "*.accessToken",
          "*.access_token",
          "*.refreshToken",
          "*.refresh_token",
          "*.password",
          "*.secret"
        ],
        censor: "[REDACTED]"
      },
      serializers: {
        req: (request) => ({
          id: request.id,
          method: request.method,
          route: request.routeOptions?.url
        }),
        res: (reply) => ({ statusCode: reply.statusCode })
      }
    },
    logController: new LogController({
      disableRequestLogging: true
    })
  });

  server.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    reply.header("Pragma", "no-cache");
    if (request.protocol === "https") {
      reply.header("Strict-Transport-Security", "max-age=31536000");
    }
  });

  server.setErrorHandler((error, request, reply) => {
    const requestId = header(request, "x-request-id") ?? request.id;
    const appError =
      error instanceof ZodError
        ? new AppError({
            code: "INVALID_REQUEST",
            message: "请求格式不符合契约。",
            statusCode: 400,
            retryable: false,
            details: {
              issues: error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message
              }))
            }
          })
        : isMalformedJsonError(error)
          ? new AppError({
              code: "INVALID_REQUEST",
              message: "请求正文不是有效 JSON。",
              statusCode: 400,
              retryable: false,
              details: { reason: "MALFORMED_JSON" }
            })
          : isBodyTooLargeError(error)
            ? new AppError({
                code: "INVALID_REQUEST",
                message: "请求正文超过允许大小。",
                statusCode: 413,
                retryable: false,
                details: { reason: "BODY_TOO_LARGE" }
              })
        : unknownToAppError(error);
    request.log.error(
      {
        requestId,
        code: appError.code,
        statusCode: appError.statusCode
      },
      "request failed"
    );
    const suppliedDemoToken = header(request, "x-hush-demo-token");
    const demo =
      dependencies.config.HUSH_DEMO_MODE &&
      suppliedDemoToken !== null &&
      dependencies.config.HUSH_DEMO_TOKEN !== undefined &&
      safeTokenEqual(
        suppliedDemoToken,
        dependencies.config.HUSH_DEMO_TOKEN
      );
    const origin = graphOrigin(
      dependencies,
      demo,
      request.url.startsWith("/v1/inbox")
        ? "inbox"
        : request.url.startsWith("/v1/handoff")
          ? "handoff"
          : request.url.startsWith("/v1/rest/evaluate")
            ? "rest_decision"
            : request.url.startsWith("/v1/rest/recommend")
              ? "rest_manual"
              : "rest",
      responseContractVersion(request)
    );
    const contractVersion = responseContractVersion(request);
    setResponseHeaders(reply, requestId, origin, contractVersion);
    void reply
      .status(appError.statusCode)
      .send(toErrorResponse(appError, requestId, contractVersion));
  });

  server.get("/v1/health", async (request, reply) => {
    const requestId = header(request, "x-request-id") ?? request.id;
    const origin =
      dependencies.restOrigin === "real" &&
      dependencies.handoffOrigin === "real" &&
      dependencies.inboxOrigin === "real"
        ? "real"
        : "mock";
    setResponseHeaders(reply, requestId, origin, CONTRACT_VERSION);
    return {
      status: "ok",
      contract_version: CONTRACT_VERSION,
      providers: {
        rest_decision: dependencies.restDecisionHealth
      }
    };
  });

  server.post("/v1/rest/evaluate", async (request, reply) => {
    const context = requestContext(
      request,
      reply,
      dependencies,
      true,
      "rest_decision"
    );
    const cancellation = requestCancellation(request, reply);
    try {
      return await context.rest.evaluate(
        request.body,
        context.requestId,
        {
          signal: cancellation.signal,
          contractVersion: context.contractVersion
        }
      );
    } finally {
      cancellation.dispose();
    }
  });

  server.post("/v1/rest/check-in", async (request, reply) => {
    const context = requestContext(
      request,
      reply,
      dependencies,
      true,
      "rest"
    );
    const input = fatigueCheckInSchema.parse(request.body);
    assertBodyRequestId(input.request_id, context.requestId);
    return context.rest.checkIn(input);
  });

  server.post("/v1/rest/recommend", async (request, reply) => {
    const context = requestContext(
      request,
      reply,
      dependencies,
      true,
      "rest_manual"
    );
    const cancellation = requestCancellation(request, reply);
    try {
      return await context.rest.recommend(
        request.body,
        context.requestId,
        {
          signal: cancellation.signal,
          contractVersion: context.contractVersion
        }
      );
    } finally {
      cancellation.dispose();
    }
  });

  server.post("/v1/rest/feedback", async (request, reply) => {
    const context = requestContext(
      request,
      reply,
      dependencies,
      true,
      "rest"
    );
    const idempotencyKey = requiredIdempotencyKey(request);
    const input = restFeedbackSchema.parse(request.body);
    assertBodyRequestId(input.request_id, context.requestId);
    await context.rest.recordFeedback(input, idempotencyKey);
    return reply.status(202).send();
  });

  server.post("/v1/handoff/start", async (request, reply) => {
    const context = requestContext(
      request,
      reply,
      dependencies,
      true,
      "handoff"
    );
    const idempotencyKey = requiredIdempotencyKey(request);
    const input = handoffStartRequestSchema.parse(request.body);
    assertBodyRequestId(input.request_id, context.requestId);
    const job = await context.handoff.start(input, idempotencyKey);
    return reply.status(202).send(job);
  });

  server.get<{
    Params: { jobId: string };
  }>("/v1/handoff/:jobId", async (request, reply) => {
    const context = requestContext(
      request,
      reply,
      dependencies,
      false,
      "handoff"
    );
    return context.handoff.get(request.params.jobId, context.requestId);
  });

  server.post<{
    Params: { jobId: string };
  }>("/v1/handoff/:jobId/cancel", async (request, reply) => {
    const context = requestContext(
      request,
      reply,
      dependencies,
      false,
      "handoff"
    );
    await context.handoff.cancel(request.params.jobId);
    return reply.status(202).send();
  });

  registerInboxRoutes(server, {
    context: (request, reply, hasBody, access) => {
      const context = requestContext(
        request,
        reply,
        dependencies,
        hasBody,
        "inbox",
        access
      );
      return {
        requestId: context.requestId,
        principalId: context.principalId,
        inbox: context.inbox
      };
    },
    assertBodyRequestId,
    requiredIdempotencyKey
  });

  return server;
}

function requestContext(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: ServerDependencies,
  hasBody: boolean,
  graph: GraphKind,
  inboxAccess: "app" | "connector" = "app"
): RequestContext {
  const requestId = requiredHeader(request, "x-request-id");
  requiredHeader(request, "x-client-version");
  const contractVersion = requiredHeader(request, "x-contract-version");
  const supportedContractVersions =
    graph === "rest_decision" || graph === "rest_manual"
      ? [CONTRACT_VERSION, DYNAMIC_REST_CONTRACT_VERSION]
      : [CONTRACT_VERSION];
  if (!supportedContractVersions.includes(contractVersion as never)) {
    throw new AppError({
      code: "CONTRACT_VERSION_UNSUPPORTED",
      message: "客户端契约版本不受支持。",
      statusCode: 409,
      retryable: false,
      details: {
        requested: contractVersion,
        supported: supportedContractVersions
      }
    });
  }

  const demoHeaderValue = request.headers["x-hush-demo-token"];
  const demoToken = header(request, "x-hush-demo-token");
  const demoTokenSupplied = demoHeaderValue !== undefined;
  let demo = false;
  if (demoTokenSupplied) {
    if (
      !dependencies.config.HUSH_DEMO_MODE ||
      dependencies.config.HUSH_DEMO_TOKEN === undefined ||
      !safeTokenEqual(
        demoToken,
        dependencies.config.HUSH_DEMO_TOKEN
      )
    ) {
      throw new AppError({
        code: "DEMO_MODE_DISABLED",
        message: "样例模式未启用或凭证无效。",
        statusCode: 403,
        retryable: false
      });
    }
    demo = true;
  }
  const principalId = authenticateInboxRequest(
    request,
    dependencies.config,
    graph,
    inboxAccess,
    demo,
    demoToken
  );
  if (hasBody && request.body === null) {
    throw new AppError({
      code: "INVALID_REQUEST",
      message: "请求正文不能为空。",
      statusCode: 400,
      retryable: false
    });
  }

  const negotiatedContractVersion =
    contractVersion as RestContractVersion;
  const origin = graphOrigin(
    dependencies,
    demo,
    graph,
    negotiatedContractVersion
  );
  setResponseHeaders(
    reply,
    requestId,
    origin,
    negotiatedContractVersion
  );
  return {
    requestId,
    principalId,
    origin,
    contractVersion: negotiatedContractVersion,
    rest: demo ? dependencies.demoRest : dependencies.rest,
    handoff: demo ? dependencies.demoHandoff : dependencies.handoff,
    inbox: demo ? dependencies.demoInbox : dependencies.inbox
  };
}

function authenticateInboxRequest(
  request: FastifyRequest,
  config: AppConfig,
  graph: GraphKind,
  access: "app" | "connector",
  demo: boolean,
  demoToken: string | null
): string {
  if (graph !== "inbox") {
    return "not-applicable";
  }
  if (demo) {
    if (access === "connector") {
      return `demo-connector:${tokenDigest(demoToken ?? "")}`;
    }
    return appSessionPrincipal(
      request,
      `demo:${tokenDigest(demoToken ?? "")}`
    );
  }
  const expected =
    access === "connector"
      ? config.HUSH_CONNECTOR_TOKEN
      : config.HUSH_APP_TOKEN;
  const supplied = bearerToken(header(request, "authorization"));
  if (!expected || !supplied || !safeTokenEqual(supplied, expected)) {
    throw new AppError({
      code: "INBOX_AUTH_REQUIRED",
      message:
        access === "connector"
          ? "需要有效的 Connector 凭证。"
          : "需要有效的 Hush App 会话。",
      statusCode: 401,
      retryable: false
    });
  }
  const authenticatedPrincipal = `${access}:${tokenDigest(supplied)}`;
  return access === "app"
    ? appSessionPrincipal(request, authenticatedPrincipal)
    : authenticatedPrincipal;
}

function appSessionPrincipal(
  request: FastifyRequest,
  authenticatedPrincipal: string
): string {
  const session = header(request, "x-hush-app-session");
  if (
    !session ||
    session.length < 32 ||
    session.length > 128 ||
    /[\u0000-\u001F\u007F-\u009F]/u.test(session)
  ) {
    throw new AppError({
      code: "INBOX_AUTH_REQUIRED",
      message: "需要有效的 Hush App 会话标识。",
      statusCode: 401,
      retryable: false
    });
  }
  return `app-session:${tokenDigest(
    `${authenticatedPrincipal}\u0000${session}`
  )}`;
}

function bearerToken(value: string | null): string | null {
  const match = /^Bearer ([^\s]+)$/iu.exec(value ?? "");
  return match?.[1] ?? null;
}

function tokenDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function graphOrigin(
  dependencies: ServerDependencies,
  demo: boolean,
  graph: GraphKind,
  contractVersion: RestContractVersion = CONTRACT_VERSION
): DataOrigin {
  if (demo) {
    if (graph === "inbox") {
      return dependencies.demoInboxOrigin;
    }
    return graph === "rest" ||
      graph === "rest_decision" ||
      graph === "rest_manual"
      ? dependencies.demoRestOrigin
      : dependencies.demoHandoffOrigin;
  }
  if (graph === "rest_decision") {
    return contractVersion === DYNAMIC_REST_CONTRACT_VERSION
      ? dependencies.restDecisionOrigin
      : dependencies.legacyRestDecisionOrigin;
  }
  if (graph === "rest_manual") {
    return contractVersion === DYNAMIC_REST_CONTRACT_VERSION
      ? dependencies.manualRestOrigin
      : dependencies.restOrigin;
  }
  if (graph === "inbox") {
    return dependencies.inboxOrigin;
  }
  return graph === "rest"
    ? dependencies.restOrigin
    : dependencies.handoffOrigin;
}

function assertBodyRequestId(
  bodyRequestId: string,
  headerRequestId: string
): void {
  if (bodyRequestId !== headerRequestId) {
    throw new AppError({
      code: "INVALID_REQUEST",
      message: "正文 request_id 必须与 X-Request-ID 相同。",
      statusCode: 400,
      retryable: false
    });
  }
}

function requiredHeader(
  request: FastifyRequest,
  name: string
): string {
  const value = header(request, name);
  if (!value) {
    throw new AppError({
      code: "INVALID_REQUEST",
      message: `缺少请求头 ${name}。`,
      statusCode: 400,
      retryable: false
    });
  }
  return value;
}

function stripOperationSuffix(value: string, suffix: string): string {
  if (!value.endsWith(suffix) || value.length === suffix.length) {
    throw new AppError({
      code: "INVALID_REQUEST",
      message: "Unified Inbox operation path 无效。",
      statusCode: 404,
      retryable: false,
      details: { reason: "UNIFIED_INBOX_OPERATION_NOT_FOUND" }
    });
  }
  return value.slice(0, -suffix.length);
}

function requiredIdempotencyKey(request: FastifyRequest): string {
  const value = requiredHeader(request, "idempotency-key");
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (
    length < 8 ||
    length > 128 ||
    /[\u0000-\u001F\u007F-\u009F]/u.test(value)
  ) {
    throw new AppError({
      code: "INVALID_REQUEST",
      message: "Idempotency-Key 必须为 8 到 128 个字符且不得包含控制字符。",
      statusCode: 400,
      retryable: false,
      details: { reason: "INVALID_IDEMPOTENCY_KEY" }
    });
  }
  return normalized;
}

function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" && value.length > 0 ? value : null;
}

function setResponseHeaders(
  reply: FastifyReply,
  requestId: string,
  origin: DataOrigin,
  contractVersion: RestContractVersion
): void {
  reply.header("X-Request-ID", requestId);
  reply.header("X-Contract-Version", contractVersion);
  reply.header("X-Hush-Data-Origin", origin);
}

function responseContractVersion(
  request: FastifyRequest
): RestContractVersion {
  return (
    request.url.startsWith("/v1/rest/evaluate") ||
    request.url.startsWith("/v1/rest/recommend")
  ) &&
    header(request, "x-contract-version") ===
      DYNAMIC_REST_CONTRACT_VERSION
    ? DYNAMIC_REST_CONTRACT_VERSION
    : CONTRACT_VERSION;
}

function requestCancellation(
  request: FastifyRequest,
  reply: FastifyReply
): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(new Error("HTTP client disconnected."));
    }
  };
  const abortIncompleteResponse = (): void => {
    if (!reply.raw.writableEnded) {
      abort();
    }
  };
  request.raw.once("aborted", abort);
  reply.raw.once("close", abortIncompleteResponse);
  request.raw.socket.once("close", abortIncompleteResponse);
  if (request.raw.aborted) {
    abort();
  }
  return {
    signal: controller.signal,
    dispose: () => {
      request.raw.removeListener("aborted", abort);
      reply.raw.removeListener("close", abortIncompleteResponse);
      request.raw.socket.removeListener(
        "close",
        abortIncompleteResponse
      );
    }
  };
}

function isMalformedJsonError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return (
    ("code" in error &&
      error.code === "FST_ERR_CTP_INVALID_JSON_BODY") ||
    (error instanceof SyntaxError &&
      "statusCode" in error &&
      error.statusCode === 400)
  );
}

function isBodyTooLargeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
  );
}

export function safeTokenEqual(
  left: string | null | undefined,
  right: string
): boolean {
  const leftDigest = createHash("sha256")
    .update(left ?? "")
    .digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
