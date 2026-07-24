import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRestDecisionModelInput,
  REST_DECISION_SYSTEM_PROMPT
} from "../../src/agent/rest-decision/rest-decision-prompt.js";
import { parseRestDecisionModelOutput } from "../../src/agent/rest-decision/rest-decision-output.js";
import { RestDecisionExecutor } from "../../src/application/rest/rest-decision-execution.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";
import { restSuggestionReasonCodeSchema } from "../../src/domain/contracts.js";
import type {
  RestDecisionCandidate,
  RestDecisionContext,
  RestDecisionProvider
} from "../../src/domain/ports.js";

interface EvaluationFixtures {
  signal_cases: Array<{
    id: string;
    dailyMinutes: number | null;
    continuousMinutes: number;
    continuousIsEstimated: boolean;
    appSwitchesLast10Minutes: number | null;
    localHour: number;
    minutesSinceLastRest: number;
    selfReportedEnergy: number | null;
    recentFeedback: Array<"too_early" | "right" | "too_late">;
  }>;
  untrusted_labels: Array<{ id: string; value: string }>;
  untrusted_domains: Array<{ id: string; value: string }>;
  candidate_outputs: Array<{
    id: string;
    accepted: boolean;
    raw: string;
  }>;
  guard_messages: Array<{
    id: string;
    accepted: boolean;
    message: string;
  }>;
}

const directory = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(
    resolve(
      directory,
      "../fixtures/rest-decision-evaluation.json"
    ),
    "utf8"
  )
) as EvaluationFixtures;
const content = new FileRestContentRepository();
const allowedQuestIds = content.quests().map((quest) => quest.id);

describe("Rest Decision prompt evaluation fixtures", () => {
  it.each(fixtures.signal_cases)(
    "serializes normalized signal case $id without hidden HTTP data",
    (fixture) => {
      const input = buildRestDecisionModelInput(
        context({
          usage: {
            dailyMinutes: fixture.dailyMinutes,
            continuousMinutes: fixture.continuousMinutes,
            continuousIsEstimated:
              fixture.continuousIsEstimated
          },
          appSwitchesLast10Minutes:
            fixture.appSwitchesLast10Minutes,
          localHour: fixture.localHour,
          minutesSinceLastRest: fixture.minutesSinceLastRest,
          selfReportedEnergy: fixture.selfReportedEnergy,
          recentFeedback: fixture.recentFeedback
        }),
        allowedQuestIds
      );

      expect(input.decisionContext).toMatchObject({
        usage: {
          dailyMinutes: fixture.dailyMinutes,
          continuousMinutes: fixture.continuousMinutes,
          continuousIsEstimated:
            fixture.continuousIsEstimated
        },
        appSwitchesLast10Minutes:
          fixture.appSwitchesLast10Minutes,
        localHour: fixture.localHour,
        minutesSinceLastRest: fixture.minutesSinceLastRest,
        selfReportedEnergy: fixture.selfReportedEnergy,
        recentFeedback: fixture.recentFeedback
      });
      expect(input.constraints.allowedReasonCodes).toEqual(
        restSuggestionReasonCodeSchema.options
      );
      expect(input.constraints.allowedQuestIds).toEqual(
        allowedQuestIds
      );
      expect(input).not.toHaveProperty("requestId");
      expect(input).not.toHaveProperty("headers");
      expect(input).not.toHaveProperty("rawBody");
    }
  );

  it.each(fixtures.untrusted_labels)(
    "keeps untrusted label $id as inert JSON data",
    (fixture) => {
      const input = buildRestDecisionModelInput(
        context({
          monitoredContext: {
            ...context().monitoredContext,
            userProvidedLabel: fixture.value
          }
        }),
        allowedQuestIds
      );
      const serialized = JSON.stringify(input);

      expect(REST_DECISION_SYSTEM_PROMPT).not.toContain(
        fixture.value
      );
      expect(
        JSON.parse(serialized).decisionContext.monitoredContext
          .userProvidedLabel
      ).toBe(fixture.value);
    }
  );

  it.each(fixtures.untrusted_domains)(
    "keeps instruction-like domain $id as inert JSON data",
    (fixture) => {
      const input = buildRestDecisionModelInput(
        context({
          source: {
            platform: "macos",
            triggerSource: "macos_website_checkpoint",
            targetType: "website"
          },
          monitoredContext: {
            ...context().monitoredContext,
            userProvidedLabel: null,
            labelSource: "domain",
            websiteDomain: fixture.value
          }
        }),
        allowedQuestIds
      );
      const serialized = JSON.stringify(input);

      expect(REST_DECISION_SYSTEM_PROMPT).not.toContain(
        fixture.value
      );
      expect(
        JSON.parse(serialized).decisionContext.monitoredContext
          .websiteDomain
      ).toBe(fixture.value);
    }
  );

  it.each(fixtures.candidate_outputs)(
    "enforces candidate fixture $id",
    (fixture) => {
      const parse = () =>
        parseRestDecisionModelOutput(
          fixture.raw,
          allowedQuestIds
        );
      if (fixture.accepted) {
        expect(parse).not.toThrow();
      } else {
        expect(parse).toThrow();
      }
    }
  );

  it.each(fixtures.guard_messages)(
    "enforces output guard fixture $id",
    async (fixture) => {
      const executor = new RestDecisionExecutor(
        new FixedProvider({
          shouldOfferRest: true,
          reasonCode: "long_continuous_use",
          message: fixture.message,
          defaultQuestId: "look_far_01"
        }),
        content
      );
      const result = await executor.execute(
        usagePayload(),
        "req_evaluation_guard"
      );

      expect(result.kind).toBe(
        fixture.accepted ? "responded" : "rejected"
      );
    }
  );
});

class FixedProvider implements RestDecisionProvider {
  readonly dataOrigin = "mock" as const;

  constructor(
    private readonly candidate: RestDecisionCandidate
  ) {}

  async health() {
    return "ready" as const;
  }

  async decide(): Promise<RestDecisionCandidate> {
    return structuredClone(this.candidate);
  }
}

function context(
  overrides: Partial<RestDecisionContext> = {}
): RestDecisionContext {
  return {
    requestId: "req_evaluation",
    measuredAt: "2026-07-24T04:00:00Z",
    source: {
      platform: "ios",
      triggerSource: "device_activity_threshold",
      targetType: "app"
    },
    monitoredContext: {
      userProvidedLabel: "阅读",
      labelSource: "user",
      websiteDomain: null,
      rawAppIdentityAvailable: false,
      fullUrlAvailable: false,
      pageTitleAvailable: false
    },
    usage: {
      dailyMinutes: 60,
      continuousMinutes: 35,
      continuousIsEstimated: true
    },
    appSwitchesLast10Minutes: 2,
    localHour: 14,
    minutesSinceLastRest: 180,
    selfReportedEnergy: null,
    recentFeedback: [],
    outputConstraints: {
      maximumMessageCharacters: 240,
      mayControlDevice: false,
      mayChangeNextThreshold: false
    },
    ...overrides
  };
}

function usagePayload() {
  return {
    schema_version: "1.0",
    request_id: "req_evaluation_guard",
    measured_at: "2026-07-24T04:00:00Z",
    platform: "ios",
    trigger_source: "device_activity_threshold",
    user_provided_context_label: "阅读",
    daily_app_usage_minutes: 60,
    estimated_continuous_app_usage_minutes: 35,
    continuous_usage_is_estimated: true,
    app_switches_last_10_minutes: 2,
    local_hour: 14,
    minutes_since_last_rest: 180,
    self_reported_energy: null,
    recent_feedback: [],
    raw_app_names_included: false
  };
}
