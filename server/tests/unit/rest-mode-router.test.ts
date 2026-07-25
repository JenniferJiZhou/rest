import { describe, expect, it } from "vitest";
import {
  fatigueReflectionSchema,
  restQuestRecommendationSchema,
  type FatigueCheckIn,
  type RestQuest,
  type RestRecommendationRequest
} from "../../src/domain/contracts.js";
import type { RestDecisionContext } from "../../src/domain/ports.js";
import { routeRestAgentMode } from "../../src/agent/rest-mode-router.js";

describe("Rest Agent mode router", () => {
  it("routes Mode A to the dynamic prompt and generated-task schema", () => {
    const route = routeRestAgentMode({
      mode: "work_state_or_rest_decision",
      context: decisionContext()
    });
    const input = JSON.parse(route.input) as Record<string, unknown>;

    expect(route.promptVersion).toBe("dynamic-rest-decision-v1.1");
    expect(route.outputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [
        "shouldOfferRest",
        "reasonCode",
        "message",
        "generatedTask"
      ]
    });
    expect(input).not.toHaveProperty("allowedQuestIds");
    expect(JSON.stringify(input)).not.toContain("allowedQuestIds");
    expect(route.system).not.toContain("allowedQuestIds");
  });

  it("routes Mode B to the fixed manual Quest prompt and schema", () => {
    const route = routeRestAgentMode({
      mode: "manual_rest_quest",
      request: manualRequest(),
      allowedQuests: [quest()]
    });

    expect(route.promptVersion).toBe("manual-rest-quest-v1.0");
    expect(route.prompt).toContain(
      "Select exactly one quest from the provided fixed library."
    );
    expect(route.outputSchema).toBe(restQuestRecommendationSchema);
  });

  it("routes Mode C to the fatigue reflection prompt and schema", () => {
    const route = routeRestAgentMode({
      mode: "fatigue_reflection",
      request: fatigueRequest()
    });

    expect(route.promptVersion).toBe("fatigue-reflection-v1.0");
    expect(route.prompt).toContain(
      "classify a user's self-described tiredness"
    );
    expect(route.outputSchema).toBe(fatigueReflectionSchema);
  });
});

function decisionContext(): RestDecisionContext {
  return {
    requestId: "req_router_dynamic",
    measuredAt: "2026-07-25T04:00:00Z",
    source: {
      platform: "macos",
      triggerSource: "macos_usage_checkpoint",
      targetType: "app"
    },
    monitoredContext: {
      userProvidedLabel: "写作",
      labelSource: "user",
      websiteDomain: null,
      rawAppIdentityAvailable: false,
      fullUrlAvailable: false,
      pageTitleAvailable: false
    },
    usage: {
      dailyMinutes: 90,
      continuousMinutes: 32,
      continuousIsEstimated: false
    },
    appSwitchesLast10Minutes: 4,
    localHour: 14,
    minutesSinceLastRest: 8,
    selfReportedEnergy: 3,
    recentFeedback: ["right"],
    outputConstraints: {
      maximumMessageCharacters: 240,
      mayControlDevice: false,
      mayChangeNextThreshold: false
    }
  };
}

function manualRequest(): RestRecommendationRequest {
  return {
    schema_version: "1.0",
    request_id: "req_router_manual",
    session_id: "session_router",
    content_version: "1.0.0",
    fatigue_type: "physical",
    user_preference: "quiet",
    available_minutes: 2,
    source: "manual_ios",
    location_tags: [],
    excluded_quest_ids: [],
    allowed_quest_ids: []
  };
}

function quest(): RestQuest {
  return {
    id: "look_far_01",
    content_version: "1.0.0",
    title: "看远一点",
    fatigue_types: ["physical"],
    duration_seconds: 60,
    energy_required: "very_low",
    location_tags: ["any"],
    time_tags: ["any"],
    steps: ["看向远处"],
    requires_screen: false,
    safety_note: null,
    anchor_compatible: true
  };
}

function fatigueRequest(): FatigueCheckIn {
  return {
    schema_version: "1.0",
    request_id: "req_router_fatigue",
    session_id: "session_router",
    source: "manual_ios",
    description: "脑子有点转不动",
    input_mode: "text",
    available_minutes: 2
  };
}
