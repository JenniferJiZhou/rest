import { describe, expect, it } from "vitest";
import { CannedAgentLLM } from "../../src/agent/canned-llm.js";
import { CannedRestDecisionProvider } from "../../src/agent/rest-decision-providers.js";
import { RestService } from "../../src/application/rest/rest-service.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";
import {
  InMemoryFeedbackRepository,
  InMemoryIdempotencyStore
} from "../../src/infra/in-memory.js";
import type {
  DynamicManualRestCandidate,
  DynamicManualRestContext,
  DynamicManualRestProvider,
  DynamicRestDecisionCandidate,
  ProviderHealth,
  RestDecisionContext,
  RestDecisionProvider
} from "../../src/domain/ports.js";

const createService = (): RestService => {
  const content = new FileRestContentRepository();
  return new RestService(
    new CannedAgentLLM(),
    content,
    new InMemoryFeedbackRepository(),
    new InMemoryIdempotencyStore<unknown>(),
    new CannedRestDecisionProvider(content)
  );
};

const feedbackInput = (
  requestId: string,
  overrides: Partial<Parameters<RestService["recordFeedback"]>[0]> = {}
): Parameters<RestService["recordFeedback"]>[0] => ({
  schema_version: "1.0",
  request_id: requestId,
  session_id: "session_feedback",
  quest_id: "look_far_01",
  helpfulness: "helped",
  timing: "right",
  recorded_at: "2026-07-24T15:24:00+08:00",
  notes: null,
  ...overrides
});

describe("RestService", () => {
  it("offers a rest immediately for a manual trigger", async () => {
    const result = await createService().evaluate({
      schema_version: "1.0",
      request_id: "req_manual",
      measured_at: "2026-07-24T15:20:00+08:00",
      platform: "ios",
      trigger_source: "manual_ios",
      continuous_screen_minutes: null,
      app_switches_last_10_minutes: null,
      local_hour: 15,
      minutes_since_last_rest: 1,
      self_reported_energy: 3,
      recent_feedback: [],
      raw_app_names_included: false
    }, "req_manual");

    expect(result.should_offer_rest).toBe(true);
    expect(result.reason_code).toBe("manual");
  });

  it("applies cooldown before behavioral rules", async () => {
    const result = await createService().evaluate({
      schema_version: "1.0",
      request_id: "req_cooldown",
      measured_at: "2026-07-24T15:20:00+08:00",
      platform: "macos",
      trigger_source: "macos_rule",
      continuous_screen_minutes: 120,
      app_switches_last_10_minutes: 20,
      local_hour: 15,
      minutes_since_last_rest: 5,
      self_reported_energy: null,
      recent_feedback: [],
      raw_app_names_included: false
    }, "req_cooldown");

    expect(result.should_offer_rest).toBe(false);
    expect(result.reason_code).toBe("cooldown");
  });

  it("routes Contract 1.1 evaluate through the dynamic executor", async () => {
    const content = new FileRestContentRepository();
    const dynamicProvider = new FixedDynamicProvider({
      shouldOfferRest: false,
      reasonCode: "insufficient_signal",
      message: "先照着现在的节奏继续，我在这里陪你。",
      generatedTask: null
    });
    const service = new RestService(
      new CannedAgentLLM(),
      content,
      new InMemoryFeedbackRepository(),
      new InMemoryIdempotencyStore<unknown>(),
      new CannedRestDecisionProvider(content),
      { dynamicDecisionProvider: dynamicProvider }
    );

    const result = await service.evaluate(
      {
        schema_version: "1.0",
        request_id: "req_dynamic_service",
        measured_at: "2026-07-25T04:00:00Z",
        platform: "ios",
        trigger_source: "device_activity_threshold",
        user_provided_context_label: "写作",
        daily_app_usage_minutes: 35,
        estimated_continuous_app_usage_minutes: 5,
        continuous_usage_is_estimated: true,
        app_switches_last_10_minutes: null,
        local_hour: 14,
        minutes_since_last_rest: 5,
        self_reported_energy: null,
        recent_feedback: [],
        raw_app_names_included: false
      },
      "req_dynamic_service",
      { contractVersion: "1.1" }
    );

    expect(result).toMatchObject({
      schema_version: "1.1",
      should_offer_rest: false,
      message: "先照着现在的节奏继续，我在这里陪你。",
      generated_task: null,
      default_quest_id: null,
      actions: []
    });
    expect(dynamicProvider.calls).toBe(1);
  });

  it("only returns a quest from the fixed content library", async () => {
    const service = createService();
    const result = await service.recommend({
      schema_version: "1.0",
      request_id: "req_recommend",
      session_id: "session_1",
      content_version: "1.0.0",
      fatigue_type: "cognitive_overload",
      user_preference: "quiet",
      available_minutes: 3,
      source: "ios_app",
      location_tags: ["any"],
      excluded_quest_ids: [],
      allowed_quest_ids: ["look_far_01"]
    });

    expect(result.quest_id).toBe("look_far_01");
  });

  it("returns a Contract 1.1 generated task without a Quest lookup", async () => {
    const content = {
      contentVersion(): string {
        throw new Error("Contract 1.1 must not read content version");
      },
      quests(): never {
        throw new Error("Contract 1.1 must not query Quest content");
      },
      questById(): never {
        throw new Error("Contract 1.1 must not query Quest content");
      }
    };
    const manualProvider = new FixedManualProvider({
      message: "好，现在给自己留一点空间。",
      generatedTask: {
        title: "桌边缓一缓",
        durationSeconds: 90,
        steps: ["放下双手", "看向远处", "慢慢呼吸"]
      }
    });
    const service = new RestService(
      new CannedAgentLLM(),
      content,
      new InMemoryFeedbackRepository(),
      new InMemoryIdempotencyStore<unknown>(),
      new FixedDynamicProvider({
        shouldOfferRest: false,
        reasonCode: "insufficient_signal",
        message: "",
        generatedTask: null
      }),
      { dynamicManualRestProvider: manualProvider }
    );
    const input = dynamicManualRequest("req_manual_dynamic_service");

    const first = await service.recommend(
      input,
      input.request_id,
      { contractVersion: "1.1" }
    );
    const replay = await service.recommend(
      input,
      input.request_id,
      { contractVersion: "1.1" }
    );

    expect(first).toEqual({
      schema_version: "1.1",
      request_id: input.request_id,
      message: "好，现在给自己留一点空间。",
      generated_task: {
        title: "桌边缓一缓",
        duration_seconds: 90,
        steps: ["放下双手", "看向远处", "慢慢呼吸"]
      },
      default_quest_id: null,
      actions: ["start_rest_session", "remind_later", "dismiss"]
    });
    expect(replay).toEqual(first);
    expect(manualProvider.contexts).toHaveLength(1);
    expect(manualProvider.contexts[0]).toMatchObject({
      decisionContext: null
    });
  });

  it("maps a validated settings test context to the manual Agent", async () => {
    const content = new FileRestContentRepository();
    const manualProvider = new FixedManualProvider({
      message: "先离开屏幕一小会儿。",
      generatedTask: {
        title: "望向远处",
        durationSeconds: 60,
        steps: ["放松肩膀", "看向远处"]
      }
    });
    const service = new RestService(
      new CannedAgentLLM(),
      content,
      new InMemoryFeedbackRepository(),
      new InMemoryIdempotencyStore<unknown>(),
      new CannedRestDecisionProvider(content),
      { dynamicManualRestProvider: manualProvider }
    );
    const input = {
      ...dynamicManualRequest("req_settings_context_mapping"),
      source: "settings_agent_test_ios",
      decision_context: {
        measured_at: "2026-08-09T10:15:00+08:00",
        platform: "ios" as const,
        user_provided_context_label: "阅读",
        daily_app_usage_minutes: 35,
        continuous_app_usage_minutes: 15,
        continuous_usage_is_estimated: true,
        app_switches_last_10_minutes: null,
        minutes_since_last_rest: 90,
        local_hour: 10,
        raw_app_names_included: false as const,
        full_url_included: false as const,
        page_title_included: false as const,
        learning_eligible: false as const
      }
    };

    await service.recommend(input, input.request_id, {
      contractVersion: "1.1"
    });

    expect(manualProvider.contexts).toHaveLength(1);
    expect(manualProvider.contexts[0]).toMatchObject({
      decisionContext: {
        measuredAt: "2026-08-09T10:15:00+08:00",
        platform: "ios",
        userProvidedContextLabel: "阅读",
        dailyAppUsageMinutes: 35,
        continuousAppUsageMinutes: 15,
        continuousUsageIsEstimated: true,
        appSwitchesLast10Minutes: null,
        minutesSinceLastRest: 90,
        localHour: 10,
        rawAppNamesIncluded: false,
        fullUrlIncluded: false,
        pageTitleIncluded: false,
        learningEligible: false
      }
    });
  });

  it("does not fall back to a fixed Quest when Contract 1.1 generation fails", async () => {
    const content = new FileRestContentRepository();
    const service = new RestService(
      new CannedAgentLLM(),
      content,
      new InMemoryFeedbackRepository(),
      new InMemoryIdempotencyStore<unknown>(),
      new CannedRestDecisionProvider(content)
    );
    const input = dynamicManualRequest("req_manual_unavailable");

    await expect(
      service.recommend(input, input.request_id, {
        contractVersion: "1.1"
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      fallback: null,
      details: {
        reason: "REST_DECISION_PROVIDER_UNAVAILABLE"
      }
    });
  });

  it("never asks a second follow-up after follow_up_answer is present", async () => {
    const result = await createService().checkIn({
      schema_version: "1.0",
      request_id: "req_follow_up_answered",
      session_id: "session_follow_up",
      source: "manual_ios",
      description: "我说不清是哪一种累",
      input_mode: "text",
      available_minutes: 3,
      willing_to_move: null,
      current_place: "desk",
      follow_up_answer: "脑子转不动"
    });

    expect(result.needs_follow_up).toBe(false);
    expect(result.follow_up).toBeNull();
  });

  it("records concurrent identical feedback only once", async () => {
    const repository = new InMemoryFeedbackRepository();
    const service = new RestService(
      new CannedAgentLLM(),
      new FileRestContentRepository(),
      repository,
      new InMemoryIdempotencyStore<unknown>(),
      new CannedRestDecisionProvider(
        new FileRestContentRepository()
      )
    );
    const feedback = feedbackInput("req_feedback_concurrent");

    await Promise.all(
      Array.from({ length: 20 }, () =>
        service.recordFeedback(feedback, "idem-feedback-concurrent")
      )
    );

    expect(repository.all()).toEqual([feedback]);
  });

  it("rejects the same feedback key with different content", async () => {
    const repository = new InMemoryFeedbackRepository();
    const service = new RestService(
      new CannedAgentLLM(),
      new FileRestContentRepository(),
      repository,
      new InMemoryIdempotencyStore<unknown>(),
      new CannedRestDecisionProvider(
        new FileRestContentRepository()
      )
    );
    await service.recordFeedback(
      feedbackInput("req_feedback_a"),
      "idem-feedback-conflict"
    );

    await expect(
      service.recordFeedback(
        feedbackInput("req_feedback_b", {
          helpfulness: "no_change"
        }),
        "idem-feedback-conflict"
      )
    ).rejects.toMatchObject({
      statusCode: 409
    });
    expect(repository.all()).toHaveLength(1);
  });

  it("treats request metadata as non-business feedback identity", async () => {
    const repository = new InMemoryFeedbackRepository();
    const service = new RestService(
      new CannedAgentLLM(),
      new FileRestContentRepository(),
      repository,
      new InMemoryIdempotencyStore<unknown>(),
      new CannedRestDecisionProvider(
        new FileRestContentRepository()
      )
    );

    await service.recordFeedback(
      feedbackInput("req_feedback_metadata_a"),
      "idem-feedback-metadata"
    );
    await service.recordFeedback(
      feedbackInput("req_feedback_metadata_b", {
        recorded_at: "2026-07-24T15:25:00+08:00"
      }),
      "idem-feedback-metadata"
    );

    expect(repository.all()).toHaveLength(1);
  });
});

class FixedDynamicProvider
  implements RestDecisionProvider<DynamicRestDecisionCandidate>
{
  readonly dataOrigin = "mock" as const;
  calls = 0;

  constructor(
    private readonly candidate: DynamicRestDecisionCandidate
  ) {}

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async decide(
    _context: RestDecisionContext
  ): Promise<DynamicRestDecisionCandidate> {
    this.calls += 1;
    return structuredClone(this.candidate);
  }
}

class FixedManualProvider implements DynamicManualRestProvider {
  readonly dataOrigin = "mock" as const;
  readonly contexts: DynamicManualRestContext[] = [];

  constructor(
    private readonly candidate: DynamicManualRestCandidate
  ) {}

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async generate(
    context: DynamicManualRestContext
  ): Promise<DynamicManualRestCandidate> {
    this.contexts.push(structuredClone(context));
    return structuredClone(this.candidate);
  }
}

function dynamicManualRequest(requestId: string) {
  return {
    schema_version: "1.1" as const,
    request_id: requestId,
    session_id: "session_manual_dynamic",
    fatigue_type: "cognitive_overload" as const,
    user_preference: "quiet" as const,
    available_minutes: 2,
    source: "manual_ios",
    location_tags: ["desk"]
  };
}
