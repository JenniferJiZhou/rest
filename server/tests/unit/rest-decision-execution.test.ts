import { describe, expect, it } from "vitest";
import {
  CannedRestDecisionProvider,
  UnavailableRestDecisionProvider
} from "../../src/agent/rest-decision-providers.js";
import {
  RestDecisionExecutor,
  normalizeRestDecisionContext
} from "../../src/application/rest/rest-decision-execution.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";
import type {
  RestDecisionCandidate,
  RestDecisionContext,
  RestDecisionProvider
} from "../../src/domain/ports.js";

const currentUsage = (overrides: Record<string, unknown> = {}) => ({
  schema_version: "1.0",
  request_id: "req_decision",
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

const content = new FileRestContentRepository();

describe("Rest Decision execution", () => {
  it("normalizes current usage without exposing raw App identity", () => {
    const context = normalizeRestDecisionContext(currentUsage());

    expect(context).toMatchObject({
      requestId: "req_decision",
      source: {
        platform: "ios",
        triggerSource: "device_activity_threshold",
        targetType: "app"
      },
      monitoredContext: {
        userProvidedLabel: "小红书",
        labelSource: "user",
        websiteDomain: null,
        rawAppIdentityAvailable: false,
        fullUrlAvailable: false,
        pageTitleAvailable: false
      },
      usage: {
        dailyMinutes: 35,
        continuousMinutes: 30,
        continuousIsEstimated: true
      },
      outputConstraints: {
        maximumMessageCharacters: 240,
        mayControlDevice: false,
        mayChangeNextThreshold: false
      }
    });
  });

  it("normalizes the Mac App checkpoint into the shared context", () => {
    const context = normalizeRestDecisionContext({
      ...currentUsage(),
      platform: "macos",
      trigger_source: "macos_usage_checkpoint",
      estimated_continuous_app_usage_minutes: undefined,
      continuous_app_usage_minutes: 12,
      continuous_usage_is_estimated: false
    });

    expect(context).toMatchObject({
      source: {
        platform: "macos",
        triggerSource: "macos_usage_checkpoint",
        targetType: "app"
      },
      usage: {
        dailyMinutes: 35,
        continuousMinutes: 12,
        continuousIsEstimated: false
      }
    });
  });

  it("normalizes a domain-labelled website into the shared context", () => {
    const context = normalizeRestDecisionContext({
      schema_version: "1.0",
      request_id: "req_website_context",
      measured_at: "2026-07-24T04:00:00Z",
      platform: "macos",
      trigger_source: "macos_website_checkpoint",
      target_type: "website",
      website_domain: "WWW.YouTube.COM",
      user_provided_context_label: null,
      label_source: "domain",
      daily_usage_minutes: 60,
      continuous_usage_minutes: 12,
      continuous_usage_is_estimated: false,
      app_switches_last_10_minutes: 3,
      local_hour: 14,
      minutes_since_last_rest: 180,
      self_reported_energy: null,
      recent_feedback: [],
      full_url_included: false,
      page_title_included: false
    });

    expect(context).toMatchObject({
      source: {
        platform: "macos",
        triggerSource: "macos_website_checkpoint",
        targetType: "website"
      },
      monitoredContext: {
        userProvidedLabel: null,
        labelSource: "domain",
        websiteDomain: "youtube.com",
        rawAppIdentityAvailable: false,
        fullUrlAvailable: false,
        pageTitleAvailable: false
      },
      usage: {
        dailyMinutes: 60,
        continuousMinutes: 12,
        continuousIsEstimated: false
      }
    });
  });

  it("normalizes legacy continuous screen usage", () => {
    const context = normalizeRestDecisionContext({
      schema_version: "1.0",
      request_id: "req_legacy_context",
      measured_at: "2026-07-24T15:20:00+08:00",
      platform: "macos",
      trigger_source: "macos_rule",
      continuous_screen_minutes: 25,
      app_switches_last_10_minutes: 2,
      local_hour: 15,
      minutes_since_last_rest: 90,
      self_reported_energy: null,
      recent_feedback: [],
      raw_app_names_included: false
    });

    expect(context.usage).toEqual({
      dailyMinutes: null,
      continuousMinutes: 25,
      continuousIsEstimated: false
    });
    expect(context.monitoredContext.userProvidedLabel).toBeNull();
  });

  it.each([
    [5, 5, false, "insufficient_signal"],
    [35, 30, true, "long_continuous_use"],
    [60, 5, true, "insufficient_signal"]
  ])(
    "makes a deterministic Canned decision for daily=%i estimated=%i",
    async (daily, estimated, shouldOffer, reasonCode) => {
      const result = await execute(
        currentUsage({
          daily_app_usage_minutes: daily,
          estimated_continuous_app_usage_minutes: estimated
        })
      );

      expect(result.kind).toBe("responded");
      if (result.kind === "responded") {
        expect(result.response.should_offer_rest).toBe(shouldOffer);
        expect(result.response.reason_code).toBe(reasonCode);
      }
    }
  );

  it("does not offer immediately after a completed rest", async () => {
    const result = await execute(
      currentUsage({ minutes_since_last_rest: 5 })
    );

    expect(result.kind).toBe("responded");
    if (result.kind === "responded") {
      expect(result.response).toMatchObject({
        should_offer_rest: false,
        reason_code: "cooldown"
      });
    }
  });

  it("records offer and responded stages for a true decision", async () => {
    const result = await execute(currentUsage());

    expect(result.states).toEqual([
      "received",
      "contract_validating",
      "semantic_validating",
      "normalizing",
      "policy_precheck",
      "provider_deciding",
      "output_validating",
      "quest_resolving",
      "offer",
      "responded"
    ]);
  });

  it("records no_offer and responded stages for a false decision", async () => {
    const result = await execute(
      currentUsage({
        daily_app_usage_minutes: 5,
        estimated_continuous_app_usage_minutes: 5
      })
    );

    expect(result.states.at(-2)).toBe("no_offer");
    expect(result.states.at(-1)).toBe("responded");
  });

  it("records rejected for an invalid request", async () => {
    const result = await execute(
      currentUsage({ local_hour: 24 })
    );

    expect(result.kind).toBe("rejected");
    expect(result.states.at(-1)).toBe("rejected");
  });

  it("distinguishes Provider unavailable from a normal false decision", async () => {
    const executor = new RestDecisionExecutor(
      new UnavailableRestDecisionProvider(),
      content
    );
    const result = await executor.execute(
      currentUsage(),
      "req_decision"
    );

    expect(result.kind).toBe("provider_unavailable");
    if (result.kind !== "provider_unavailable") {
      throw new Error("expected Provider unavailable result");
    }
    expect(result.error.statusCode).toBe(503);
    expect(result.states.at(-1)).toBe("provider_unavailable");
  });

  it("copies server schema version, verified request ID, and safe actions", async () => {
    const result = await execute(currentUsage());

    expect(result.kind).toBe("responded");
    if (result.kind === "responded") {
      expect(result.response).toMatchObject({
        schema_version: "1.0",
        request_id: "req_decision",
        actions: [
          "start_rest_session",
          "open_check_in",
          "remind_later",
          "dismiss"
        ]
      });
    }
  });

  it("returns the compatible false response structure", async () => {
    const result = await execute(
      currentUsage({
        daily_app_usage_minutes: 5,
        estimated_continuous_app_usage_minutes: 5
      })
    );

    expect(result.kind).toBe("responded");
    if (result.kind === "responded") {
      expect(result.response).toMatchObject({
        should_offer_rest: false,
        message: "",
        default_quest_id: null,
        actions: ["dismiss"]
      });
    }
  });

  it.each([
    [
      "overlong message",
      {
        shouldOfferRest: true,
        reasonCode: "manual",
        message: "x".repeat(241),
        defaultQuestId: "look_far_01"
      }
    ],
    [
      "invalid reason code",
      {
        shouldOfferRest: true,
        reasonCode: "made_up",
        message: "休息一下。",
        defaultQuestId: "look_far_01"
      }
    ],
    [
      "unknown Quest ID",
      {
        shouldOfferRest: true,
        reasonCode: "manual",
        message: "休息一下。",
        defaultQuestId: "not_in_fixed_library"
      }
    ],
    [
      "medical diagnosis",
      {
        shouldOfferRest: true,
        reasonCode: "manual",
        message: "你患有失眠，需要治疗。",
        defaultQuestId: "look_far_01"
      }
    ],
    [
      "raw App identity claim",
      {
        shouldOfferRest: true,
        reasonCode: "manual",
        message: "我们读取了你正在使用的真实 App。",
        defaultQuestId: "look_far_01"
      }
    ],
    [
      "precise continuous-use claim",
      {
        shouldOfferRest: true,
        reasonCode: "manual",
        message: "你已经精确连续使用了 30 分钟。",
        defaultQuestId: "look_far_01"
      }
    ],
    [
      "device-control command",
      {
        shouldOfferRest: true,
        reasonCode: "manual",
        message: "现在关闭 App 并修改下一次 threshold。",
        defaultQuestId: "look_far_01"
      }
    ]
  ])("rejects Provider output containing %s", async (_case, candidate) => {
    const result = await execute(currentUsage(), new FixedProvider(candidate));

    expect(result.kind).toBe("rejected");
    expect(result.states.at(-1)).toBe("rejected");
  });
});

function execute(
  payload: unknown,
  provider: RestDecisionProvider = new CannedRestDecisionProvider(content)
) {
  return new RestDecisionExecutor(provider, content).execute(
    payload,
    "req_decision"
  );
}

class FixedProvider implements RestDecisionProvider {
  readonly dataOrigin = "mock" as const;

  constructor(private readonly candidate: unknown) {}

  async health() {
    return "ready" as const;
  }

  async decide(
    _context: RestDecisionContext
  ): Promise<RestDecisionCandidate> {
    return this.candidate as RestDecisionCandidate;
  }
}
