import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { request as httpRequest } from "node:http";
import {
  CannedRestDecisionProvider,
  UnavailableRestDecisionProvider
} from "../../src/agent/rest-decision-providers.js";
import { RealRestDecisionProvider } from "../../src/agent/rest-decision/real-rest-decision-provider.js";
import { createServer } from "../../src/api/create-server.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";
import type {
  ProviderCallOptions,
  ProviderHealth,
  RestDecisionCandidate,
  RestDecisionContext,
  RestDecisionProvider
} from "../../src/domain/ports.js";

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

  it("never routes a Demo request through the Normal Real Provider", async () => {
    let realCalls = 0;
    const normalRealProvider = new RealRestDecisionProvider(
      {
        complete: async () => {
          realCalls += 1;
          return JSON.stringify({
            shouldOfferRest: false,
            reasonCode: "insufficient_signal",
            message: "",
            defaultQuestId: null
          });
        }
      },
      "claude-test-model",
      content
    );
    const server = await createTestServer({
      normalRestDecisionProvider: normalRealProvider
    });
    const requestId = "req_http_demo_isolated";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId, true),
      payload: iosUsage(requestId)
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-hush-data-origin"]).toBe("mock");
    expect(realCalls).toBe(0);
  });

  it("marks a successful real Rest Decision response as real without relabelling other Rest routes", async () => {
    const provider = new RealRestDecisionProvider(
      {
        complete: async () =>
          JSON.stringify({
            shouldOfferRest: false,
            reasonCode: "insufficient_signal",
            message: "",
            defaultQuestId: null
          })
      },
      "claude-test-model",
      content
    );
    const server = await createTestServer({
      normalRestDecisionProvider: provider
    });
    const requestId = "req_http_real_origin";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: iosUsage(requestId)
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-hush-data-origin"]).toBe("real");
    expect(response.json()).toMatchObject({
      request_id: requestId,
      should_offer_rest: false,
      actions: ["dismiss"]
    });
  });

  it("propagates a disconnected HTTP client to the active Provider signal", async () => {
    const provider = new ControlledRestDecisionProvider();
    const server = await createTestServer({
      normalRestDecisionProvider: provider
    });
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not expose a TCP address");
    }
    const requestId = "req_http_abort";
    const clientClosed = deferred<void>();
    const clientRequest = httpRequest(
      {
        method: "POST",
        hostname: "127.0.0.1",
        port: address.port,
        path: "/v1/rest/evaluate",
        headers: {
          ...headers(requestId),
          "content-type": "application/json",
          connection: "close"
        }
      }
    );
    clientRequest.on("error", () => clientClosed.resolve());
    clientRequest.end(JSON.stringify(iosUsage(requestId)));
    await provider.waitUntilStarted();

    try {
      clientRequest.destroy();
      await Promise.all([
        clientClosed.promise,
        provider.waitUntilAborted()
      ]);
      expect(provider.signal?.aborted).toBe(true);
    } finally {
      provider.release();
    }
  });

  it("returns 503 for model timeout classification", async () => {
    const provider = new RealRestDecisionProvider(
      {
        complete: async () => {
          throw Object.assign(new Error("late model"), {
            name: "TimeoutError"
          });
        }
      },
      "claude-test-model",
      content
    );
    const server = await createTestServer({
      normalRestDecisionProvider: provider
    });
    const requestId = "req_http_model_timeout";
    const response = await server.inject({
      method: "POST",
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: iosUsage(requestId)
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      request_id: requestId,
      error: {
        code: "LLM_TIMEOUT",
        retryable: true,
        details: { reason: "timeout" }
      }
    });
  });

  it("does not cache an invalid model output as a successful decision", async () => {
    let calls = 0;
    const provider = new RealRestDecisionProvider(
      {
        complete: async () => {
          calls += 1;
          return calls === 1
            ? "not-json"
            : JSON.stringify({
                shouldOfferRest: false,
                reasonCode: "insufficient_signal",
                message: "",
                defaultQuestId: null
              });
        }
      },
      "claude-test-model",
      content
    );
    const server = await createTestServer({
      normalRestDecisionProvider: provider
    });
    const requestId = "req_http_invalid_not_cached";
    const request = {
      method: "POST" as const,
      url: "/v1/rest/evaluate",
      headers: headers(requestId),
      payload: iosUsage(requestId)
    };

    const failed = await server.inject(request);
    const retry = await server.inject(request);

    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe("LLM_INVALID_OUTPUT");
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({
      request_id: requestId,
      should_offer_rest: false
    });
    expect(calls).toBe(2);
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

class ControlledRestDecisionProvider
  implements RestDecisionProvider
{
  readonly dataOrigin = "real" as const;
  private readonly started = deferred<void>();
  private readonly gate = deferred<void>();
  signal: AbortSignal | undefined;

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async decide(
    _context: RestDecisionContext,
    options?: ProviderCallOptions
  ): Promise<RestDecisionCandidate> {
    this.signal = options?.signal;
    this.started.resolve();
    await this.gate.promise;
    return {
      shouldOfferRest: false,
      reasonCode: "insufficient_signal",
      message: "",
      defaultQuestId: null
    };
  }

  waitUntilStarted(): Promise<void> {
    return this.started.promise;
  }

  async waitUntilAborted(): Promise<void> {
    const signal = this.signal;
    if (!signal) {
      throw new Error("provider signal is not available");
    }
    if (signal.aborted) {
      return;
    }
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), {
        once: true
      });
    });
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
