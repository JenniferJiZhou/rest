import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../src/api/create-server.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";

const baseHeaders = (requestId: string) => ({
  "x-request-id": requestId,
  "x-client-version": "0.1.0-test",
  "x-contract-version": "1.0"
});

describe("HTTP Contract v1 reconciliation", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = createServer(
      buildServerDependencies(
        loadConfig({
          NODE_ENV: "test",
          LOG_LEVEL: "silent"
        })
      )
    );
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["spaces", "        "],
    ["one character", "x"],
    ["seven characters", "1234567"],
    ["over 128 characters", "x".repeat(129)],
    ["ASCII control character", "valid-key\u0007"]
  ])("rejects an invalid Idempotency-Key: %s", async (_case, key) => {
    const requestId = `req_idem_${_case.replaceAll(" ", "_")}`;
    const headers: Record<string, string> = baseHeaders(requestId);
    if (key !== undefined) {
      headers["idempotency-key"] = key;
    }

    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/feedback",
      headers,
      payload: feedbackPayload(requestId)
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it.each([
    ["eight characters", "12345678"],
    ["UUID", "f9bd7424-7c64-43e0-b7e4-1216dc76e325"],
    ["Unicode", "交接幂等键甲乙丙丁"]
  ])("accepts a valid Idempotency-Key: %s", async (_case, key) => {
    const requestId = `req_idem_valid_${_case}`;
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/feedback",
      headers: {
        ...baseHeaders(requestId),
        "idempotency-key": key
      },
      payload: feedbackPayload(requestId)
    });

    expect(response.statusCode).toBe(202);
  });

  it("maps malformed JSON to a sanitized Contract error", async () => {
    const requestId = "req_malformed_json";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: {
        ...baseHeaders(requestId),
        "content-type": "application/json"
      },
      payload: '{"schema_version":"1.0",'
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body).toMatchObject({
      schema_version: "1.0",
      request_id: requestId,
      error: { code: "INVALID_REQUEST" }
    });
    expect(JSON.stringify(body)).not.toMatch(
      /Fastify|node_modules|[A-Z]:\\|stack/i
    );
    expectContractHeaders(response.headers, requestId, "mock");
  });

  it("returns 409 and Contract headers for a version mismatch", async () => {
    const requestId = "req_contract_mismatch";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: {
        ...baseHeaders(requestId),
        "x-contract-version": "2.0"
      },
      payload: evaluatePayload(requestId)
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(
      "CONTRACT_VERSION_UNSUPPORTED"
    );
    expectContractHeaders(response.headers, requestId, "mock");
  });

  it.each([
    ["same length", "demo-secreu"],
    ["different length", "wrong"],
    ["empty", ""],
    ["long", "x".repeat(1024)]
  ])("uniformly rejects an invalid Demo token: %s", async (_case, token) => {
    const requestId = `req_bad_demo_${_case.replaceAll(" ", "_")}`;
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: {
        ...baseHeaders(requestId),
        "x-hush-demo-token": token
      },
      payload: evaluatePayload(requestId)
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("DEMO_MODE_DISABLED");
    expect(response.body).not.toContain(token || "demo-secret");
  });

  it("returns Contract headers for health and empty 202 responses", async () => {
    const health = await server.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-request-id": "req_health_headers" }
    });
    const feedback = await server.inject({
      method: "POST",
      url: "/v1/rest/feedback",
      headers: {
        ...baseHeaders("req_feedback_headers"),
        "idempotency-key": "feedback-header-key"
      },
      payload: feedbackPayload("req_feedback_headers")
    });

    expectContractHeaders(
      health.headers,
      "req_health_headers",
      "mock"
    );
    expectContractHeaders(
      feedback.headers,
      "req_feedback_headers",
      "mock"
    );
  });

  it.each([
    ["missing", undefined, 400],
    ["unsupported", "2.0.0", 409],
    ["mismatch", "1.0.1", 409],
    ["current", "1.0.0", 200]
  ])(
    "handles %s content version with Contract headers",
    async (_case, contentVersion, statusCode) => {
      const requestId = `req_content_${_case}`;
      const payload = recommendPayload(requestId);
      if (contentVersion === undefined) {
        delete (payload as Partial<typeof payload>).content_version;
      } else {
        payload.content_version = contentVersion;
      }

      const response = await server.inject({
        method: "POST",
        url: "/v1/rest/recommend",
        headers: baseHeaders(requestId),
        payload
      });

      expect(response.statusCode).toBe(statusCode);
      expectContractHeaders(response.headers, requestId, "mock");
      if (statusCode === 409) {
        expect(response.json().error.code).toBe(
          "CONTENT_VERSION_MISMATCH"
        );
      }
    }
  );
});

function feedbackPayload(requestId: string) {
  return {
    schema_version: "1.0",
    request_id: requestId,
    session_id: `session_${requestId}`,
    quest_id: "look_far_01",
    helpfulness: "helped",
    timing: "right",
    recorded_at: "2026-07-24T15:24:00+08:00",
    notes: null
  };
}

function evaluatePayload(requestId: string) {
  return {
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
  };
}

function recommendPayload(requestId: string) {
  return {
    schema_version: "1.0",
    request_id: requestId,
    session_id: `session_${requestId}`,
    content_version: "1.0.0",
    fatigue_type: "cognitive_overload",
    user_preference: "quiet",
    available_minutes: 3,
    source: "ios_app",
    location_tags: ["any"],
    excluded_quest_ids: [],
    allowed_quest_ids: ["look_far_01"]
  };
}

function expectContractHeaders(
  headers: Record<
    string,
    string | string[] | number | undefined
  >,
  requestId: string,
  origin: "real" | "mock" | "cached"
): void {
  expect(headers["x-request-id"]).toBe(requestId);
  expect(headers["x-contract-version"]).toBe("1.0");
  expect(headers["x-hush-data-origin"]).toBe(origin);
}
