import { describe, expect, it } from "vitest";
import {
  DynamicRestDecisionExecutor
} from "../../src/application/rest/dynamic-rest-decision-execution.js";
import type {
  DynamicRestDecisionCandidate,
  ProviderHealth,
  RestDecisionContext,
  RestDecisionProvider
} from "../../src/domain/ports.js";

describe("Contract 1.1 dynamic Rest Decision execution", () => {
  it("maps a generated task without a Quest repository", async () => {
    const provider = new RecordingDynamicProvider({
      shouldOfferRest: true,
      reasonCode: "long_continuous_use",
      message: "现在可以暂时把注意力从屏幕上移开。",
      generatedTask: {
        title: "一分钟桌边重置",
        durationSeconds: 60,
        steps: ["双手离开键盘", "看向远处", "放松肩膀"]
      }
    });
    const result = await new DynamicRestDecisionExecutor(
      provider
    ).execute(usagePayload(), "req_dynamic_execution");

    expect(result.kind).toBe("responded");
    if (result.kind !== "responded") {
      throw new Error("expected a dynamic RestSuggestion");
    }
    expect(result.response).toEqual({
      schema_version: "1.1",
      request_id: "req_dynamic_execution",
      should_offer_rest: true,
      reason_code: "long_continuous_use",
      message: "现在可以暂时把注意力从屏幕上移开。",
      generated_task: {
        title: "一分钟桌边重置",
        duration_seconds: 60,
        steps: ["双手离开键盘", "看向远处", "放松肩膀"]
      },
      default_quest_id: null,
      actions: ["start_rest_session", "remind_later", "dismiss"]
    });
    expect(provider.contexts).toHaveLength(1);
  });

  it("calls the Provider inside the legacy cooldown window and returns companion state", async () => {
    const provider = new RecordingDynamicProvider({
      shouldOfferRest: false,
      reasonCode: "insufficient_signal",
      message: "先照着现在的节奏继续，我在这里陪你。",
      generatedTask: null
    });
    const result = await new DynamicRestDecisionExecutor(
      provider
    ).execute(
      usagePayload({ minutes_since_last_rest: 5 }),
      "req_dynamic_execution"
    );

    expect(provider.contexts).toHaveLength(1);
    expect(provider.contexts[0]?.minutesSinceLastRest).toBe(5);
    expect(result).toEqual({
      kind: "responded",
      response: {
        schema_version: "1.1",
        request_id: "req_dynamic_execution",
        should_offer_rest: false,
        reason_code: "insufficient_signal",
        message: "先照着现在的节奏继续，我在这里陪你。",
        generated_task: null,
        default_quest_id: null,
        actions: []
      }
    });
  });
});

class RecordingDynamicProvider
  implements RestDecisionProvider<DynamicRestDecisionCandidate>
{
  readonly dataOrigin = "real" as const;
  readonly contexts: RestDecisionContext[] = [];

  constructor(
    private readonly candidate: DynamicRestDecisionCandidate
  ) {}

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async decide(
    context: RestDecisionContext
  ): Promise<DynamicRestDecisionCandidate> {
    this.contexts.push(structuredClone(context));
    return structuredClone(this.candidate);
  }
}

function usagePayload(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "1.0",
    request_id: "req_dynamic_execution",
    measured_at: "2026-07-25T04:00:00Z",
    platform: "ios",
    trigger_source: "device_activity_threshold",
    user_provided_context_label: "写作",
    daily_app_usage_minutes: 90,
    estimated_continuous_app_usage_minutes: 30,
    continuous_usage_is_estimated: true,
    app_switches_last_10_minutes: 3,
    local_hour: 15,
    minutes_since_last_rest: 8,
    self_reported_energy: null,
    recent_feedback: [],
    raw_app_names_included: false,
    ...overrides
  };
}
