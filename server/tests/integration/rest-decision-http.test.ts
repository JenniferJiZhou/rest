import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  CannedRestDecisionProvider,
  UnavailableRestDecisionProvider
} from "../../src/agent/rest-decision-providers.js";
import { createServer } from "../../src/api/create-server.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";

const content = new FileRestContentRepository();
const servers: FastifyInstance[] = [];

const headers = (requestId: string, demo = false) => ({
  "x-request-id": requestId,
  "x-client-version": "1.0.0-test",
  "x-contract-version": "1.0",
  ...(demo ? { "x-hush-demo-token": "demo-secret" } : {})
});

const iosUsage = (
  requestId: string,
  overrides: Record<string, unknown> = {}
) => ({
  schema_version: "1.0",
  request_id: requestId,
  measured_at: "2026-07-24T04:00:00Z",
  platform: "ios",
  trigger_source: "device_activity_threshold",
  user_provided_context_label: "小红书",
  daily_app_usage_minutes: 35,
  estimated_continuous_app_usage_minutes: 30,
  continuous_usage_is_estimated: true,
  app_switches_last_10_minutes: null,
  local_hour: 14,
  minutes_since_last_rest: 180,
  self_reported_energy: null,
  recent_feedback: [],
  raw_app_names_included: false,
  ...overrides
});

describe("Cloud Rest Decision HTTP vertical slice", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it.each([
    [5, 5, false],
    [35, 30, true],
    [60, 5, true]
  ])(
    "evaluates iOS daily=%i estimated=%i deterministically",
    async (daily, estimated, shouldOffer) => {
      const server = await createTestServer();
      const requestId = `req_http_${daily}_${estimated}`;
      const response = await server.inject({
        method: "POST",
        url: "/v1/rest/evaluate",
        headers: headers(requestId),
        payload: iosUsage(requestId, {
          daily_app_usage_minutes: daily,
          estimated_continuous_app_usage_minutes: estimated
        })
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().should_offer_rest).toBe(shouldOffer);
    }
  );

  it("does not offer immediately after a rest", async () => {
    const server = await createTestServer();
    const requestId = "req_http_cooldown";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: iosUsage(requestId, { minutes_since_last_rest: 5 })
    });

    expect(response.json()).toMatchObject({
      should_offer_rest: false,
      reason_code: "cooldown"
    });
  });

  it("accepts the current Mac App checkpoint", async () => {
    const server = await createTestServer();
    const requestId = "req_http_mac_app";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: {
        schema_version: "1.0",
        request_id: requestId,
        measured_at: "2026-07-24T04:00:00Z",
        platform: "macos",
        trigger_source: "macos_usage_checkpoint",
        user_provided_context_label: "写作",
        daily_app_usage_minutes: 35,
        continuous_app_usage_minutes: 30,
        continuous_usage_is_estimated: false,
        app_switches_last_10_minutes: 2,
        local_hour: 14,
        minutes_since_last_rest: 180,
        self_reported_energy: null,
        recent_feedback: [],
        raw_app_names_included: false
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().should_offer_rest).toBe(true);
  });

  it("accepts a normalized Mac website hostname", async () => {
    const server = await createTestServer();
    const requestId = "req_http_mac_website";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: websiteUsage(requestId, "WWW.YouTube.COM")
    });

    expect(response.statusCode).toBe(200);
  });

  it("accepts both Website label combinations used by Apple", async () => {
    const server = await createTestServer();
    const userId = "req_http_mac_website_user";
    const domainId = "req_http_mac_website_domain";
    const userResponse = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(userId),
      payload: websiteUsage(userId, "youtube.com", {
        label_source: "user",
        user_provided_context_label: "学习"
      })
    });
    const domainResponse = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(domainId),
      payload: websiteUsage(domainId, "youtube.com", {
        label_source: "domain",
        user_provided_context_label: null
      })
    });

    expect(userResponse.statusCode).toBe(200);
    expect(domainResponse.statusCode).toBe(200);
  });

  it("returns an Apple-decodable complete Contract response", async () => {
    const server = await createTestServer();
    const requestId = "req_http_swift_decode";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: iosUsage(requestId)
    });
    const body = response.json();

    expect(body).toMatchObject({
      schema_version: "1.0",
      request_id: requestId,
      should_offer_rest: expect.any(Boolean),
      reason_code: expect.any(String),
      message: expect.any(String),
      actions: expect.any(Array)
    });
    expect(body.actions).toEqual(
      expect.arrayContaining([
        "start_rest_session",
        "open_check_in",
        "remind_later",
        "dismiss"
      ])
    );
  });

  it("reuses a decision for the same request ID and payload", async () => {
    const server = await createTestServer();
    const requestId = "req_http_evaluate_retry";
    const request = {
      method: "POST" as const,
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: iosUsage(requestId)
    };

    const first = await server.inject(request);
    const retry = await server.inject(request);

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
  });

  it("returns 409 when an evaluate request ID is reused with different content", async () => {
    const server = await createTestServer();
    const requestId = "req_http_evaluate_conflict";
    const first = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: iosUsage(requestId)
    });
    const conflict = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: iosUsage(requestId, {
        daily_app_usage_minutes: 36
      })
    });

    expect(first.statusCode).toBe(200);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      request_id: requestId,
      error: {
        code: "INVALID_REQUEST",
        retryable: false,
        details: { reason: "REQUEST_ID_REUSED" }
      }
    });
  });

  it("rejects current and legacy usage fields together", async () => {
    const server = await createTestServer();
    const requestId = "req_http_usage_conflict";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: iosUsage(requestId, { continuous_screen_minutes: 30 })
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("rejects a website domain containing a URL path", async () => {
    const server = await createTestServer();
    const requestId = "req_http_website_path";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: websiteUsage(requestId, "youtube.com/watch")
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("returns 503 and Contract headers when the Provider is unavailable", async () => {
    const server = await createTestServer({
      normalRestDecisionProvider:
        new UnavailableRestDecisionProvider()
    });
    const requestId = "req_http_provider_unavailable";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: iosUsage(requestId)
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("INTERNAL_ERROR");
    expect(response.headers).toMatchObject({
      "x-request-id": requestId,
      "x-contract-version": "1.0",
      "x-hush-data-origin": "mock"
    });
  });

  it("marks both independent Canned Normal and Demo graphs as mock", async () => {
    const server = await createTestServer({
      normalRestDecisionProvider:
        new CannedRestDecisionProvider(content),
      demoRestDecisionProvider:
        new CannedRestDecisionProvider(content)
    });
    const normalId = "req_http_normal_canned";
    const demoId = "req_http_demo_canned";
    const normal = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(normalId),
      payload: iosUsage(normalId)
    });
    const demo = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(demoId, true),
      payload: iosUsage(demoId)
    });

    expect(normal.headers["x-hush-data-origin"]).toBe("mock");
    expect(demo.headers["x-hush-data-origin"]).toBe("mock");
  });
});

function websiteUsage(
  requestId: string,
  domain: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    schema_version: "1.0",
    request_id: requestId,
    measured_at: "2026-07-24T04:00:00Z",
    platform: "macos",
    trigger_source: "macos_website_checkpoint",
    target_type: "website",
    website_domain: domain,
    label_source: "domain",
    daily_usage_minutes: 35,
    continuous_usage_minutes: 30,
    continuous_usage_is_estimated: false,
    app_switches_last_10_minutes: 2,
    local_hour: 14,
    minutes_since_last_rest: 180,
    self_reported_energy: null,
    recent_feedback: [],
    full_url_included: false,
    page_title_included: false,
    ...overrides
  };
}

async function createTestServer(
  overrides: Parameters<typeof buildServerDependencies>[1] = {}
) {
  const server = createServer(
    buildServerDependencies(
      loadConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        HUSH_DEMO_MODE: "true",
        HUSH_DEMO_TOKEN: "demo-secret"
      }),
      overrides
    )
  );
  await server.ready();
  servers.push(server);
  return server;
}
