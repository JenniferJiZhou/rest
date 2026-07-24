import { describe, expect, it } from "vitest";
import { CannedAgentLLM } from "../../src/agent/canned-llm.js";
import { RestService } from "../../src/application/rest/rest-service.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";
import {
  InMemoryFeedbackRepository,
  InMemoryIdempotencyStore
} from "../../src/infra/in-memory.js";

const createService = (): RestService =>
  new RestService(
    new CannedAgentLLM(),
    new FileRestContentRepository(),
    new InMemoryFeedbackRepository(),
    new InMemoryIdempotencyStore<boolean>()
  );

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
  it("offers a rest immediately for a manual trigger", () => {
    const result = createService().evaluate({
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
    });

    expect(result.should_offer_rest).toBe(true);
    expect(result.reason_code).toBe("manual");
  });

  it("applies cooldown before behavioral rules", () => {
    const result = createService().evaluate({
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
    });

    expect(result.should_offer_rest).toBe(false);
    expect(result.reason_code).toBe("cooldown");
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
      new InMemoryIdempotencyStore<boolean>()
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
      new InMemoryIdempotencyStore<boolean>()
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
      new InMemoryIdempotencyStore<boolean>()
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
