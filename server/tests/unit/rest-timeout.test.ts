import { afterEach, describe, expect, it, vi } from "vitest";
import { CannedAgentLLM } from "../../src/agent/canned-llm.js";
import { RestService } from "../../src/application/rest/rest-service.js";
import type {
  FatigueCheckIn,
  FatigueReflection,
  RestQuest,
  RestQuestRecommendation,
  RestRecommendationRequest
} from "../../src/domain/contracts.js";
import type { ProviderCallOptions } from "../../src/domain/ports.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";
import {
  InMemoryFeedbackRepository,
  InMemoryIdempotencyStore
} from "../../src/infra/in-memory.js";

describe("Rest provider timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds fatigue reflection and releases its timer", async () => {
    vi.useFakeTimers();
    const agent = new NeverRestAgent();
    const service = createService(agent);
    const result = service.checkIn({
      schema_version: "1.0",
      request_id: "req_rest_timeout",
      session_id: "session_rest_timeout",
      source: "manual_ios",
      description: "tired",
      input_mode: "text",
      available_minutes: 3,
      willing_to_move: null,
      current_place: "desk",
      follow_up_answer: null
    });
    const rejection = expect(result).rejects.toMatchObject({
      code: "LLM_TIMEOUT"
    });

    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(agent.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

function createService(agent: CannedAgentLLM): RestService {
  return new RestService(
    agent,
    new FileRestContentRepository(),
    new InMemoryFeedbackRepository(),
    new InMemoryIdempotencyStore<boolean>(),
    { llmTimeoutMs: 100 }
  );
}

class NeverRestAgent extends CannedAgentLLM {
  signal: AbortSignal | undefined;

  override async reflectFatigue(
    _input: FatigueCheckIn,
    options?: ProviderCallOptions
  ): Promise<FatigueReflection> {
    this.signal = options?.signal;
    return new Promise<FatigueReflection>(() => {});
  }

  override async chooseQuest(
    _input: RestRecommendationRequest,
    _allowedQuests: RestQuest[],
    options?: ProviderCallOptions
  ): Promise<RestQuestRecommendation> {
    this.signal = options?.signal;
    return new Promise<RestQuestRecommendation>(() => {});
  }
}
