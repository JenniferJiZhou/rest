import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  RealRestDecisionProvider,
  type RestDecisionModelClient,
  type RestDecisionModelRequest
} from "../../src/agent/rest-decision/real-rest-decision-provider.js";
import { createServer } from "../../src/api/create-server.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";

const servers: FastifyInstance[] = [];

describe("Real Rest Decision TCP vertical slice", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("runs iOS, Mac App, and Mac website through the bounded Real Provider", async () => {
    const model = new RecordingModelClient();
    const content = new FileRestContentRepository();
    const server = createServer(
      buildServerDependencies(
        loadConfig({
          NODE_ENV: "test",
          LOG_LEVEL: "silent"
        }),
        {
          normalRestDecisionProvider:
            new RealRestDecisionProvider(
              model,
              "claude-test-model",
              content
            )
        }
      )
    );
    await server.listen({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    const address = server.server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not expose a TCP address");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const cases = [
      {
        requestId: "req_vertical_real_ios",
        expectedTarget: "app",
        payload: iosUsage("req_vertical_real_ios")
      },
      {
        requestId: "req_vertical_real_mac_app",
        expectedTarget: "app",
        payload: macAppUsage("req_vertical_real_mac_app")
      },
      {
        requestId: "req_vertical_real_website",
        expectedTarget: "website",
        payload: websiteUsage("req_vertical_real_website")
      }
    ];

    for (const fixture of cases) {
      const response = await fetch(
        `${baseUrl}/v1/rest/evaluate`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": fixture.requestId,
            "x-client-version": "1.0.0-vertical",
            "x-contract-version": "1.0"
          },
          body: JSON.stringify(fixture.payload)
        }
      );
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(response.headers.get("x-hush-data-origin")).toBe(
        "real"
      );
      expect(body).toMatchObject({
        schema_version: "1.0",
        request_id: fixture.requestId,
        should_offer_rest: false,
        message: "",
        default_quest_id: null,
        actions: ["dismiss"]
      });
      const modelInput = JSON.parse(
        model.requests.at(-1)!.input
      );
      expect(modelInput.decisionContext.targetType).toBe(
        fixture.expectedTarget
      );
      expect(modelInput).not.toHaveProperty("requestId");
    }

    expect(model.requests).toHaveLength(3);
  });
});

class RecordingModelClient implements RestDecisionModelClient {
  readonly requests: RestDecisionModelRequest[] = [];

  async complete(
    request: RestDecisionModelRequest
  ): Promise<string> {
    this.requests.push(structuredClone(request));
    return JSON.stringify({
      shouldOfferRest: false,
      reasonCode: "insufficient_signal",
      message: "",
      defaultQuestId: null
    });
  }
}

function common(requestId: string) {
  return {
    schema_version: "1.0",
    request_id: requestId,
    measured_at: "2026-07-24T04:00:00Z",
    app_switches_last_10_minutes: 2,
    local_hour: 14,
    minutes_since_last_rest: 180,
    self_reported_energy: null,
    recent_feedback: []
  };
}

function iosUsage(requestId: string) {
  return {
    ...common(requestId),
    platform: "ios",
    trigger_source: "device_activity_threshold",
    user_provided_context_label: "阅读",
    daily_app_usage_minutes: 60,
    estimated_continuous_app_usage_minutes: 35,
    continuous_usage_is_estimated: true,
    raw_app_names_included: false
  };
}

function macAppUsage(requestId: string) {
  return {
    ...common(requestId),
    platform: "macos",
    trigger_source: "macos_usage_checkpoint",
    user_provided_context_label: "写作",
    daily_app_usage_minutes: 60,
    continuous_app_usage_minutes: 35,
    continuous_usage_is_estimated: false,
    raw_app_names_included: false
  };
}

function websiteUsage(requestId: string) {
  return {
    ...common(requestId),
    platform: "macos",
    trigger_source: "macos_website_checkpoint",
    target_type: "website",
    website_domain: "example.com",
    label_source: "domain",
    user_provided_context_label: null,
    daily_usage_minutes: 60,
    continuous_usage_minutes: 35,
    continuous_usage_is_estimated: false,
    full_url_included: false,
    page_title_included: false
  };
}
