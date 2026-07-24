import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../src/api/create-server.js";
import {
  createApplicationServer,
  createShutdownHandler
} from "../../src/bootstrap.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";

const servers: FastifyInstance[] = [];

describe("HTTPS deployment readiness", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("does not trust a forwarded HTTPS protocol by default", async () => {
    const server = await createTestServer(false);
    const response = await server.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-forwarded-proto": "https" }
    });

    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });

  it("recognizes platform-terminated HTTPS only when trust proxy is enabled", async () => {
    const server = await createTestServer(true);
    const response = await server.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-forwarded-proto": "https" }
    });

    expect(response.headers["strict-transport-security"]).toBe(
      "max-age=31536000"
    );
  });

  it("sets no-sniff, no-referrer, and no-store headers on success", async () => {
    const server = await createTestServer(false);
    const response = await server.inject({
      method: "GET",
      url: "/v1/health"
    });

    expect(response.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
      pragma: "no-cache"
    });
  });

  it("sets the same baseline security headers on errors", async () => {
    const server = await createTestServer(false);
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
      pragma: "no-cache",
      "x-contract-version": "1.0"
    });
  });

  it("keeps health independent from Provider calls", async () => {
    const config = testConfig(false);
    const dependencies = buildServerDependencies(config);
    const providerHealth = vi.fn(async () => {
      throw new Error("must not be called by liveness");
    });
    dependencies.providerHealth = providerHealth;
    const server = createServer(dependencies);
    await server.ready();
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      contract_version: "1.0"
    });
    expect(providerHealth).not.toHaveBeenCalled();
  });

  it("does not log credentials, request bodies, or context labels", async () => {
    const output: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });
    const server = createServer(
      buildServerDependencies(
        loadConfig({
          NODE_ENV: "test",
          LOG_LEVEL: "info",
          HUSH_DEMO_MODE: "true",
          HUSH_DEMO_TOKEN: "server-demo-secret"
        })
      )
    );
    await server.ready();

    await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate?private=query",
      headers: {
        authorization: "Bearer authorization-secret",
        cookie: "session=cookie-secret",
        "x-hush-demo-token": "wrong-demo-secret",
        "x-request-id": "req_log_safety",
        "x-client-version": "1.0.0-test",
        "x-contract-version": "1.0"
      },
      payload: {
        user_provided_context_label: "private-context-label",
        private_body: "private-body-marker"
      }
    });
    await server.close();
    write.mockRestore();

    const logs = output.join("");
    expect(logs).not.toContain("authorization-secret");
    expect(logs).not.toContain("cookie-secret");
    expect(logs).not.toContain("wrong-demo-secret");
    expect(logs).not.toContain("server-demo-secret");
    expect(logs).not.toContain("private-context-label");
    expect(logs).not.toContain("private-body-marker");
    expect(logs).not.toContain("private=query");
  });

  it("rejects oversized JSON without echoing request content", async () => {
    const server = await createTestServer(false);
    const secretMarker = "do-not-echo-this-marker";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_oversized"
      },
      payload: {
        user_provided_context_label:
          secretMarker.repeat(5_000)
      }
    });

    expect(response.statusCode).toBe(413);
    expect(response.body).not.toContain(secretMarker);
  });

  it("supports the unavailable Rest Decision failure-injection mode", async () => {
    const server = createApplicationServer({
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://hush-staging.example.com",
      HUSH_REST_DECISION_PROVIDER: "unavailable",
      LOG_LEVEL: "silent"
    });
    await server.ready();
    servers.push(server);
    const requestId = "req_unavailable_mode";

    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: {
        "x-request-id": requestId,
        "x-client-version": "1.0.0-test",
        "x-contract-version": "1.0"
      },
      payload: {
        schema_version: "1.0",
        request_id: requestId,
        measured_at: "2026-07-24T04:00:00Z",
        platform: "ios",
        trigger_source: "device_activity_threshold",
        user_provided_context_label: "Writing",
        daily_app_usage_minutes: 35,
        estimated_continuous_app_usage_minutes: 30,
        continuous_usage_is_estimated: true,
        app_switches_last_10_minutes: null,
        local_hour: 14,
        minutes_since_last_rest: 180,
        self_reported_energy: null,
        recent_feedback: [],
        raw_app_names_included: false
      }
    });

    expect(response.statusCode).toBe(503);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "closes exactly once on %s without an unhandled rejection",
    async (signal) => {
      const server = await createTestServer(false);
      const close = vi
        .spyOn(server, "close")
        .mockResolvedValue(undefined);
      const exit = vi.fn();
      const shutdown = createShutdownHandler(server, exit);

      await Promise.all([shutdown(signal), shutdown(signal)]);

      expect(close).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    }
  );
});

async function createTestServer(
  trustProxy: boolean
): Promise<FastifyInstance> {
  const server = createServer(
    buildServerDependencies(testConfig(trustProxy))
  );
  await server.ready();
  servers.push(server);
  return server;
}

function testConfig(trustProxy: boolean) {
  return loadConfig({
    NODE_ENV: "test",
    TRUST_PROXY: trustProxy ? "true" : "false",
    LOG_LEVEL: "silent"
  });
}
