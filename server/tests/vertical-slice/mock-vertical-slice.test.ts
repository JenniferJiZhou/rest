import type { FastifyInstance } from "fastify";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from "vitest";
import { CannedAgentLLM } from "../../src/agent/canned-llm.js";
import { createServer } from "../../src/api/create-server.js";
import {
  buildServerDependencies,
  type ServerCompositionOverrides
} from "../../src/composition.js";
import { loadConfig, type AppConfig } from "../../src/config.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";
import {
  handoffJobStateSchema,
  type HandoffJobState
} from "../../src/domain/contracts.js";
import type {
  DraftRequest,
  DraftResult,
  HandoffAgentInput,
  HandoffSummaryDraft,
  MailFetchContext,
  MailItem,
  MailProvider,
  ProviderCallOptions,
  ProviderHealth
} from "../../src/domain/ports.js";
import {
  FixtureMailProvider,
  MessagingHandoffCompletionSink,
  RecordingMessagingChannel,
  UnavailableMailProvider
} from "../../src/infra/provider-stubs.js";

const DEMO_TOKEN = "demo-secret";
const CLIENT_VERSION = "0.1.0-apple-integration";
const baseUrls = new WeakMap<FastifyInstance, string>();

const baseHeaders = (
  requestId: string,
  options: { demo?: boolean; idempotencyKey?: string } = {}
) => ({
  "x-request-id": requestId,
  "x-client-version": CLIENT_VERSION,
  "x-contract-version": "1.0",
  ...(options.demo
    ? { "x-hush-demo-token": DEMO_TOKEN }
    : {}),
  ...(options.idempotencyKey
    ? { "idempotency-key": options.idempotencyKey }
    : {})
});

const usagePayload = (requestId: string) => ({
  schema_version: "1.0",
  request_id: requestId,
  measured_at: "2026-07-24T15:20:00+08:00",
  platform: "ios",
  trigger_source: "manual_ios",
  continuous_screen_minutes: null,
  app_switches_last_10_minutes: null,
  local_hour: 15,
  minutes_since_last_rest: 96,
  self_reported_energy: 2,
  recent_feedback: [],
  raw_app_names_included: false
});

describe("W1-04 Mock Vertical Slice", () => {
  const servers: FastifyInstance[] = [];
  const recordingMessaging = new RecordingMessagingChannel();
  const controlledAgent = new ControlledCannedAgentLLM();
  let mockServer: FastifyInstance;

  beforeAll(async () => {
    mockServer = await createTestServer(
      demoConfig(true),
      {
        realAgent: controlledAgent,
        demoAgent: controlledAgent,
        realMail: new FixtureMailProvider(),
        demoMail: new FixtureMailProvider(),
        messagingChannel: recordingMessaging,
        demoCompletionSink: new MessagingHandoffCompletionSink(
          recordingMessaging,
          "mock-apple-client"
        )
      },
      servers
    );
  });

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.close()));
  });

  it("runs the complete Rest flow through Fastify HTTP routes", async () => {
    const health = await request(mockServer, {
      method: "GET",
      url: "/v1/health"
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: "ok",
      contract_version: "1.0",
      providers: {
        agent: "ready",
        gmail: "ready",
        messaging_fallback: "ready"
      }
    });

    const evaluateId = "req_vertical_evaluate";
    const evaluate = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: baseHeaders(evaluateId, { demo: true }),
      payload: usagePayload(evaluateId)
    });
    expect(evaluate.statusCode).toBe(200);
    expect(evaluate.headers["x-request-id"]).toBe(evaluateId);
    expect(evaluate.headers["x-contract-version"]).toBe("1.0");
    expect(evaluate.headers["x-hush-data-origin"]).toBe("mock");
    expect(evaluate.json()).toMatchObject({
      request_id: evaluateId,
      should_offer_rest: true,
      reason_code: "manual"
    });

    const firstCheckInId = "req_vertical_check_in_first";
    const firstCheckIn = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/check-in",
      headers: baseHeaders(firstCheckInId, { demo: true }),
      payload: {
        schema_version: "1.0",
        request_id: firstCheckInId,
        session_id: "rest-session-vertical",
        source: "manual_ios",
        description: "我说不清楚是哪一种累",
        input_mode: "text",
        available_minutes: 3,
        willing_to_move: null,
        current_place: "desk",
        follow_up_answer: null
      }
    });
    expect(firstCheckIn.statusCode).toBe(200);
    expect(firstCheckIn.json()).toMatchObject({
      needs_follow_up: true,
      fatigue_type: "unknown"
    });
    expect(firstCheckIn.json().follow_up.options).toHaveLength(3);

    const secondCheckInId = "req_vertical_check_in_second";
    const secondCheckIn = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/check-in",
      headers: baseHeaders(secondCheckInId, { demo: true }),
      payload: {
        schema_version: "1.0",
        request_id: secondCheckInId,
        session_id: "rest-session-vertical",
        source: "manual_ios",
        description: "我说不清楚是哪一种累",
        input_mode: "text",
        available_minutes: 3,
        willing_to_move: null,
        current_place: "desk",
        follow_up_answer: "脑子转不动"
      }
    });
    expect(secondCheckIn.statusCode).toBe(200);
    expect(secondCheckIn.json()).toMatchObject({
      needs_follow_up: false,
      follow_up: null,
      fatigue_type: "cognitive_overload"
    });

    const recommendId = "req_vertical_recommend";
    const recommend = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/recommend",
      headers: baseHeaders(recommendId, { demo: true }),
      payload: {
        schema_version: "1.0",
        request_id: recommendId,
        session_id: "rest-session-vertical",
        content_version: "1.0.0",
        fatigue_type: "cognitive_overload",
        user_preference: "quiet",
        available_minutes: 3,
        source: "ios_app",
        location_tags: ["any"],
        excluded_quest_ids: [],
        allowed_quest_ids: ["look_far_01"]
      }
    });
    expect(recommend.statusCode).toBe(200);
    expect(recommend.json()).toMatchObject({
      content_version: "1.0.0",
      quest_id: "look_far_01"
    });
    expect(
      new FileRestContentRepository().questById(
        recommend.json().quest_id
      )
    ).toBeDefined();

    const feedbackId = "req_vertical_feedback";
    const feedback = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/feedback",
      headers: baseHeaders(feedbackId, {
        demo: true,
        idempotencyKey: "idem-vertical-feedback"
      }),
      payload: {
        schema_version: "1.0",
        request_id: feedbackId,
        session_id: "rest-session-vertical",
        quest_id: "look_far_01",
        helpfulness: "helped",
        timing: "right",
        recorded_at: "2026-07-24T15:24:00+08:00",
        notes: null
      }
    });
    expect(feedback.statusCode).toBe(202);
    expect(feedback.headers["x-hush-data-origin"]).toBe("mock");
  });

  it("runs OPEN_LOOPS_ONLY Handoff, polling, idempotency, and recording messaging", async () => {
    const requestId = "req_vertical_handoff";
    const payload = {
      schema_version: "1.0",
      request_id: requestId,
      source: "ios_app",
      include_gmail: false,
      gmail_account_id: null,
      open_loops: [
        {
          id: "ol_vertical_1",
          text: "明天先确认提交材料格式",
          desired_time: "tomorrow_morning"
        },
        {
          id: "ol_vertical_2",
          text: "检查首页深色模式按钮",
          desired_time: "tomorrow"
        }
      ],
      response_channel: "imessage",
      timezone: "Asia/Shanghai",
      locale: "zh-CN"
    };
    const headers = baseHeaders(requestId, {
      demo: true,
      idempotencyKey: "idem-vertical-handoff"
    });

    const first = await request(mockServer, {
      method: "POST",
      url: "/v1/handoff/start",
      headers,
      payload
    });
    const duplicate = await request(mockServer, {
      method: "POST",
      url: "/v1/handoff/start",
      headers,
      payload
    });

    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ status: "queued" });
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json().job_id).toBe(first.json().job_id);

    const jobId = first.json().job_id as string;
    const running = await waitForStatus(
      mockServer,
      jobId,
      ["running"],
      DEMO_TOKEN
    );
    expect(running.status).toBe("running");
    controlledAgent.releaseHandoff();

    const terminal = await waitForTerminalState(
      mockServer,
      jobId,
      DEMO_TOKEN
    );
    expect(terminal.status).toBe("succeeded");
    expect(terminal.summary).not.toBeNull();

    const receipt = terminal.summary!.pause_receipt;
    expect(receipt.coverage.included_sources).toContain(
      "user_submitted_open_loops"
    );
    expect(receipt.coverage.excluded_sources).toContain(
      "authorized_gmail_not_requested"
    );
    expect(receipt.held_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ol_vertical_1" }),
        expect.objectContaining({ id: "ol_vertical_2" })
      ])
    );
    expect(receipt.tomorrow_first_step).toBeTruthy();
    expect(receipt.conclusion).toContain("未请求检查 Gmail");
    expect(receipt.coverage_note).toContain("已覆盖来源");

    await waitUntil(() => recordingMessaging.sent().length === 1);
    expect(recordingMessaging.sent()[0]).toMatchObject({
      recipientId: "mock-apple-client",
      correlationId: jobId
    });
  });

  it("cancels a controlled slow Job without producing a succeeded result", async () => {
    const slowMail = new ControlledSlowMailProvider();
    const server = await createTestServer(
      demoConfig(false),
      { realMail: slowMail },
      servers
    );
    const requestId = "req_vertical_cancel";
    const start = await request(server, {
      method: "POST",
      url: "/v1/handoff/start",
      headers: baseHeaders(requestId, {
        idempotencyKey: "idem-vertical-cancel"
      }),
      payload: {
        schema_version: "1.0",
        request_id: requestId,
        source: "ios_app",
        include_gmail: true,
        gmail_account_id: "controlled",
        open_loops: [
          {
            id: "ol_cancel",
            text: "这项任务不应在取消后完成",
            desired_time: "tomorrow"
          }
        ],
        response_channel: "app",
        timezone: "Asia/Shanghai",
        locale: "zh-CN"
      }
    });
    const jobId = start.json().job_id as string;
    await slowMail.waitUntilFetchStarts();

    const cancelRequestId = "req_vertical_cancel_action";
    const cancel = await request(server, {
      method: "POST",
      url: `/v1/handoff/${jobId}/cancel`,
      headers: baseHeaders(cancelRequestId)
    });
    expect(cancel.statusCode).toBe(202);

    const cancelled = await getJob(server, jobId, "req_cancelled_state");
    expect(cancelled).toMatchObject({
      status: "cancelled",
      summary: null
    });

    slowMail.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const afterProviderReturns = await getJob(
      server,
      jobId,
      "req_cancelled_after_provider"
    );
    expect(afterProviderReturns).toMatchObject({
      status: "cancelled",
      summary: null
    });
    expect(slowMail.receivedOptions?.signal?.aborted).toBe(true);
  });

  it("degrades unavailable Gmail to a successful OPEN_LOOPS_ONLY result", async () => {
    const server = await createTestServer(
      demoConfig(false),
      { realMail: new UnavailableMailProvider() },
      servers
    );
    const requestId = "req_vertical_gmail_unavailable";
    const start = await request(server, {
      method: "POST",
      url: "/v1/handoff/start",
      headers: baseHeaders(requestId, {
        idempotencyKey: "idem-vertical-gmail-unavailable"
      }),
      payload: {
        schema_version: "1.0",
        request_id: requestId,
        source: "ios_app",
        include_gmail: true,
        gmail_account_id: "unavailable",
        open_loops: [
          {
            id: "ol_unavailable_1",
            text: "明天确认展示顺序",
            desired_time: "tomorrow_morning"
          },
          {
            id: "ol_unavailable_2",
            text: "检查备用演示视频",
            desired_time: "tomorrow"
          }
        ],
        response_channel: "app",
        timezone: "Asia/Shanghai",
        locale: "zh-CN"
      }
    });
    const terminal = await waitForTerminalState(
      server,
      start.json().job_id
    );
    expect(terminal.status).toBe("succeeded");
    expect(
      terminal.summary?.pause_receipt.coverage.excluded_sources
    ).toContain("authorized_gmail_unavailable");
    expect(terminal.summary?.pause_receipt.held_items).toHaveLength(2);
    expect(terminal.summary?.pause_receipt.conclusion).toContain(
      "Gmail 本次不可用"
    );
  });

  it("enables Sample Mode only with both server opt-in and a valid token", async () => {
    const disabledServer = await createTestServer(
      demoConfig(false),
      {},
      servers
    );
    const disabledId = "req_sample_disabled";
    const disabled = await request(disabledServer, {
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: {
        ...baseHeaders(disabledId),
        "x-hush-demo-token": DEMO_TOKEN
      },
      payload: usagePayload(disabledId)
    });
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json().error.code).toBe("DEMO_MODE_DISABLED");
    expect(disabled.headers["x-hush-data-origin"]).toBe("mock");

    const wrongTokenId = "req_sample_wrong_token";
    const wrongToken = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: {
        ...baseHeaders(wrongTokenId),
        "x-hush-demo-token": "wrong-demo-token"
      },
      payload: usagePayload(wrongTokenId)
    });
    expect(wrongToken.statusCode).toBe(403);
    expect(wrongToken.json().error.code).toBe("DEMO_MODE_DISABLED");
    expect(wrongToken.headers["x-hush-data-origin"]).toBe("mock");

    const noTokenId = "req_sample_no_token";
    const noToken = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: baseHeaders(noTokenId),
      payload: usagePayload(noTokenId)
    });
    expect(noToken.statusCode).toBe(200);
    expect(noToken.headers["x-hush-data-origin"]).toBe("mock");

    const validId = "req_sample_valid";
    const valid = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: baseHeaders(validId, { demo: true }),
      payload: usagePayload(validId)
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.headers["x-hush-data-origin"]).toBe("mock");
  });

  it("enforces request, contract, validation, and error protocols", async () => {
    const unknownFieldId = "req_protocol_unknown_field";
    const unknownField = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: baseHeaders(unknownFieldId, { demo: true }),
      payload: {
        ...usagePayload(unknownFieldId),
        unexpected_field: true
      }
    });
    assertProtocolError(unknownField, {
      statusCode: 400,
      requestId: unknownFieldId,
      code: "INVALID_REQUEST",
      origin: "mock"
    });

    const illegalEnumId = "req_protocol_illegal_enum";
    const illegalEnum = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: baseHeaders(illegalEnumId, { demo: true }),
      payload: {
        ...usagePayload(illegalEnumId),
        platform: "watchos"
      }
    });
    assertProtocolError(illegalEnum, {
      statusCode: 400,
      requestId: illegalEnumId,
      code: "INVALID_REQUEST",
      origin: "mock"
    });

    const notFoundId = "req_protocol_job_not_found";
    const notFound = await request(mockServer, {
      method: "GET",
      url: "/v1/handoff/not-a-real-job",
      headers: baseHeaders(notFoundId, { demo: true })
    });
    assertProtocolError(notFound, {
      statusCode: 404,
      requestId: notFoundId,
      code: "JOB_NOT_FOUND",
      origin: "mock"
    });

    const mismatchId = "req_protocol_contract_mismatch";
    const mismatch = await request(mockServer, {
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: {
        ...baseHeaders(mismatchId, { demo: true }),
        "x-contract-version": "2.0"
      },
      payload: usagePayload(mismatchId)
    });
    assertProtocolError(mismatch, {
      statusCode: 409,
      requestId: mismatchId,
      code: "CONTRACT_VERSION_UNSUPPORTED",
      origin: "mock"
    });
  });
});

async function createTestServer(
  config: AppConfig,
  overrides: ServerCompositionOverrides,
  servers: FastifyInstance[]
): Promise<FastifyInstance> {
  const server = createServer(buildServerDependencies(config, overrides));
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not expose a TCP address");
  }
  baseUrls.set(server, `http://127.0.0.1:${address.port}`);
  servers.push(server);
  return server;
}

function demoConfig(enabled: boolean): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    PORT: enabled ? "3011" : "3012",
    PUBLIC_BASE_URL: enabled
      ? "http://localhost:3011"
      : "http://localhost:3012",
    HUSH_DEMO_MODE: enabled ? "true" : "false",
    ...(enabled ? { HUSH_DEMO_TOKEN: DEMO_TOKEN } : {}),
    LOG_LEVEL: "silent"
  });
}

async function getJob(
  server: FastifyInstance,
  jobId: string,
  requestId: string,
  demoToken?: string
): Promise<HandoffJobState> {
  const response = await request(server, {
    method: "GET",
    url: `/v1/handoff/${jobId}`,
    headers: {
      ...baseHeaders(requestId),
      ...(demoToken
        ? { "x-hush-demo-token": demoToken }
        : {})
    }
  });
  expect(response.statusCode).toBe(200);
  return handoffJobStateSchema.parse(response.json());
}

async function waitForStatus(
  server: FastifyInstance,
  jobId: string,
  statuses: HandoffJobState["status"][],
  demoToken?: string
): Promise<HandoffJobState> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await getJob(
      server,
      jobId,
      `req_vertical_poll_${attempt}`,
      demoToken
    );
    if (statuses.includes(state.status)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    `handoff job did not reach any expected status: ${statuses.join(", ")}`
  );
}

async function waitForTerminalState(
  server: FastifyInstance,
  jobId: string,
  demoToken?: string
): Promise<HandoffJobState> {
  return waitForStatus(
    server,
    jobId,
    ["succeeded", "failed", "cancelled"],
    demoToken
  );
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition was not met before timeout");
}

function assertProtocolError(
  response: HttpTestResponse,
  expected: {
    statusCode: number;
    requestId: string;
    code: string;
    origin: "real" | "mock" | "cached";
  }
): void {
  expect(response.statusCode).toBe(expected.statusCode);
  expect(response.headers["x-request-id"]).toBe(expected.requestId);
  expect(response.headers["x-contract-version"]).toBe("1.0");
  expect(response.headers["x-hush-data-origin"]).toBe(expected.origin);
  expect(response.json()).toMatchObject({
    schema_version: "1.0",
    request_id: expected.requestId,
    error: {
      code: expected.code,
      retryable: false
    }
  });
}

interface HttpTestResponse {
  statusCode: number;
  headers: Record<string, string | undefined>;
  json(): {
    schema_version: string;
    request_id: string;
    error: { code: string; retryable: boolean };
    [key: string]: any;
  };
}

async function request(
  server: FastifyInstance,
  options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }
): Promise<HttpTestResponse> {
  const baseUrl = baseUrls.get(server);
  if (!baseUrl) {
    throw new Error("test server has not started listening");
  }
  const response = await fetch(`${baseUrl}${options.url}`, {
    method: options.method,
    headers: {
      ...(options.payload === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...options.headers
    },
    ...(options.payload === undefined
      ? {}
      : { body: JSON.stringify(options.payload) })
  });
  const text = await response.text();
  const body = text.length > 0 ? JSON.parse(text) : {};
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    json: () => structuredClone(body)
  };
}

class ControlledCannedAgentLLM extends CannedAgentLLM {
  private readonly handoffGate = deferred<void>();

  override async summarizeHandoff(
    input: HandoffAgentInput
  ): Promise<HandoffSummaryDraft> {
    await this.handoffGate.promise;
    return super.summarizeHandoff(input);
  }

  releaseHandoff(): void {
    this.handoffGate.resolve();
  }
}

class ControlledSlowMailProvider implements MailProvider {
  private readonly started = deferred<void>();
  private readonly gate = deferred<void>();
  receivedOptions: ProviderCallOptions | undefined;

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async fetchUnread(
    _context: MailFetchContext,
    options?: ProviderCallOptions
  ): Promise<MailItem[]> {
    this.receivedOptions = options;
    this.started.resolve();
    await this.gate.promise;
    return [];
  }

  async createDraft(
    _request: DraftRequest,
    _options?: ProviderCallOptions
  ): Promise<DraftResult> {
    return { draftId: "unused-controlled-draft" };
  }

  waitUntilFetchStarts(): Promise<void> {
    return this.started.promise;
  }

  release(): void {
    this.gate.resolve();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
