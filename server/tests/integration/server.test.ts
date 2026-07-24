import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../src/api/create-server.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";
import {
  handoffJobStateSchema,
  type HandoffJobState
} from "../../src/domain/contracts.js";

const baseHeaders = (requestId: string) => ({
  "x-request-id": requestId,
  "x-client-version": "0.1.0-test",
  "x-contract-version": "1.0"
});

describe("Hush API", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "3001",
      PUBLIC_BASE_URL: "http://localhost:3001",
      HUSH_DEMO_MODE: "true",
      HUSH_DEMO_TOKEN: "demo-secret",
      LOG_LEVEL: "silent"
    });
    server = createServer(buildServerDependencies(config));
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it("reports provider health without exposing secrets", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/v1/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      contract_version: "1.0",
      providers: {
        agent: "ready",
        gmail: "unavailable"
      }
    });
  });

  it("enforces body and header request ID equality", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: baseHeaders("req_header"),
      payload: {
        schema_version: "1.0",
        request_id: "req_body",
        measured_at: "2026-07-24T15:20:00+08:00",
        platform: "ios",
        trigger_source: "manual_ios",
        continuous_screen_minutes: null,
        app_switches_last_10_minutes: null,
        local_hour: 15,
        minutes_since_last_rest: 96,
        self_reported_energy: 3,
        recent_feedback: [],
        raw_app_names_included: false
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("marks valid sample-mode responses as mock", async () => {
    const requestId = "req_demo";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: {
        ...baseHeaders(requestId),
        "x-hush-demo-token": "demo-secret"
      },
      payload: {
        schema_version: "1.0",
        request_id: requestId,
        measured_at: "2026-07-24T15:20:00+08:00",
        platform: "ios",
        trigger_source: "manual_ios",
        continuous_screen_minutes: null,
        app_switches_last_10_minutes: null,
        local_hour: 15,
        minutes_since_last_rest: 96,
        self_reported_energy: 3,
        recent_feedback: [],
        raw_app_names_included: false
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-hush-data-origin"]).toBe("mock");
  });

  it("returns HTTP 409 for a feedback key reused with different content", async () => {
    const firstRequestId = "req_feedback_http_a";
    const secondRequestId = "req_feedback_http_b";
    const payload = (requestId: string, helpfulness: string) => ({
      schema_version: "1.0",
      request_id: requestId,
      session_id: "session_feedback_http",
      quest_id: "look_far_01",
      helpfulness,
      timing: "right",
      recorded_at: "2026-07-24T15:24:00+08:00",
      notes: null
    });
    const first = await server.inject({
      method: "POST",
      url: "/v1/rest/feedback",
      headers: {
        ...baseHeaders(firstRequestId),
        "idempotency-key": "idem-feedback-http-conflict"
      },
      payload: payload(firstRequestId, "helped")
    });
    const conflict = await server.inject({
      method: "POST",
      url: "/v1/rest/feedback",
      headers: {
        ...baseHeaders(secondRequestId),
        "idempotency-key": "idem-feedback-http-conflict"
      },
      payload: payload(secondRequestId, "no_change")
    });

    expect(first.statusCode).toBe(202);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("INVALID_REQUEST");
  });

  it("completes open-loop handoff when Gmail is unavailable", async () => {
    const requestId = "req_handoff_real";
    const startResponse = await server.inject({
      method: "POST",
      url: "/v1/handoff/start",
      headers: {
        ...baseHeaders(requestId),
        "idempotency-key": "idem-handoff-real"
      },
      payload: {
        schema_version: "1.0",
        request_id: requestId,
        source: "ios_app",
        include_gmail: true,
        gmail_account_id: "demo",
        open_loops: [
          {
            id: "ol_1",
            text: "明天先确认提交材料",
            desired_time: "tomorrow_morning"
          }
        ],
        response_channel: "app",
        timezone: "Asia/Shanghai",
        locale: "zh-CN"
      }
    });
    expect(startResponse.statusCode).toBe(202);
    const jobId = startResponse.json().job_id as string;

    const state = await waitForTerminalState(server, jobId);
    expect(state.status).toBe("succeeded");
    if (!state.summary) {
      throw new Error("successful handoff must include a summary");
    }
    expect(
      state.summary.pause_receipt.coverage.excluded_sources
    ).toContain("authorized_gmail_unavailable");
    expect(state.summary.pause_receipt.held_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ol_1",
          status: "saved_for_tomorrow"
        })
      ])
    );
  });

  it("uses fixture mail and idempotent drafts in sample mode", async () => {
    const requestId = "req_handoff_demo";
    const payload = {
      schema_version: "1.0",
      request_id: requestId,
      source: "debug",
      include_gmail: true,
      gmail_account_id: "demo",
      open_loops: [],
      response_channel: "app",
      timezone: "Asia/Shanghai",
      locale: "zh-CN"
    };
    const headers = {
      ...baseHeaders(requestId),
      "x-hush-demo-token": "demo-secret",
      "idempotency-key": "idem-handoff-demo"
    };
    const first = await server.inject({
      method: "POST",
      url: "/v1/handoff/start",
      headers,
      payload
    });
    const second = await server.inject({
      method: "POST",
      url: "/v1/handoff/start",
      headers,
      payload
    });
    expect(first.statusCode).toBe(202);
    expect(second.json().job_id).toBe(first.json().job_id);

    const state = await waitForTerminalState(
      server,
      first.json().job_id,
      "demo-secret"
    );
    expect(state.status).toBe("succeeded");
    expect(state.summary?.total_unread).toBe(2);
    expect(state.summary?.drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ saved: true })
      ])
    );
    expect(state.summary?.uncertain).toHaveLength(1);
  });

  it("returns HTTP 409 for an idempotency key reused by another Handoff request", async () => {
    const firstRequestId = "req_handoff_conflict_a";
    const secondRequestId = "req_handoff_conflict_b";
    const idempotencyKey = "idem-handoff-http-conflict";
    const payload = (requestId: string, text: string) => ({
      schema_version: "1.0",
      request_id: requestId,
      source: "ios_app",
      include_gmail: false,
      gmail_account_id: null,
      open_loops: [
        {
          id: "ol_http_conflict",
          text,
          desired_time: "tomorrow"
        }
      ],
      response_channel: "app",
      timezone: "Asia/Shanghai",
      locale: "zh-CN"
    });
    const first = await server.inject({
      method: "POST",
      url: "/v1/handoff/start",
      headers: {
        ...baseHeaders(firstRequestId),
        "idempotency-key": idempotencyKey
      },
      payload: payload(firstRequestId, "回复李老师")
    });
    const conflict = await server.inject({
      method: "POST",
      url: "/v1/handoff/start",
      headers: {
        ...baseHeaders(secondRequestId),
        "idempotency-key": idempotencyKey
      },
      payload: payload(secondRequestId, "准备演示材料")
    });

    expect(first.statusCode).toBe(202);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("INVALID_REQUEST");
  });

  it("completes a handoff without invoking Gmail when include_gmail is false", async () => {
    const requestId = "req_handoff_no_gmail";
    const startResponse = await server.inject({
      method: "POST",
      url: "/v1/handoff/start",
      headers: {
        ...baseHeaders(requestId),
        "idempotency-key": "idem-handoff-no-gmail"
      },
      payload: {
        schema_version: "1.0",
        request_id: requestId,
        source: "ios_app",
        include_gmail: false,
        gmail_account_id: null,
        open_loops: [
          {
            id: "ol_no_gmail",
            text: "明天先确认提交材料的格式",
            desired_time: "tomorrow_morning"
          }
        ],
        response_channel: "app",
        timezone: "Asia/Shanghai",
        locale: "zh-CN"
      }
    });

    expect(startResponse.statusCode).toBe(202);
    const state = await waitForTerminalState(
      server,
      startResponse.json().job_id
    );
    expect(state.status).toBe("succeeded");
    expect(
      state.summary?.pause_receipt.coverage.excluded_sources
    ).toContain("authorized_gmail_not_requested");
    expect(
      Object.hasOwn(
        state.summary?.pause_receipt ?? {},
        "tomorrow_first_step"
      )
    ).toBe(true);
  });
});

async function waitForTerminalState(
  server: FastifyInstance,
  jobId: string,
  demoToken?: string
): Promise<HandoffJobState> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const requestId = `req_poll_${attempt}`;
    const response = await server.inject({
      method: "GET",
      url: `/v1/handoff/${jobId}`,
      headers: {
        ...baseHeaders(requestId),
        ...(demoToken
          ? { "x-hush-demo-token": demoToken }
          : {})
      }
    });
    const state = handoffJobStateSchema.parse(response.json());
    if (["succeeded", "failed", "cancelled"].includes(state.status)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("handoff job did not reach a terminal state");
}
