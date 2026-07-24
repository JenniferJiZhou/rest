import { afterEach, describe, expect, it, vi } from "vitest";
import { CannedAgentLLM } from "../../src/agent/canned-llm.js";
import { RestService } from "../../src/application/rest/rest-service.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";
import type {
  ProviderCallOptions,
  ProviderHealth,
  RestDecisionCandidate,
  RestDecisionContext,
  RestDecisionProvider
} from "../../src/domain/ports.js";
import {
  InMemoryFeedbackRepository,
  InMemoryIdempotencyStore
} from "../../src/infra/in-memory.js";

describe("Rest Decision timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts a late Provider result and releases its timer", async () => {
    vi.useFakeTimers();
    const provider = new SlightlyLateProvider();
    const service = createService(provider, 100);
    const result = service.evaluate(
      usagePayload(),
      "req_decision_timeout"
    );
    const rejection = expect(result).rejects.toMatchObject({
      code: "LLM_TIMEOUT",
      statusCode: 503,
      details: { reason: "timeout" }
    });

    await vi.advanceTimersByTimeAsync(101);
    await rejection;

    expect(provider.signal?.aborted).toBe(true);
    expect(provider.completed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates a parent AbortSignal and releases the timeout", async () => {
    vi.useFakeTimers();
    const provider = new SlightlyLateProvider();
    const service = createService(provider, 3_500);
    const controller = new AbortController();
    const result = service.evaluate(
      usagePayload(),
      "req_decision_timeout",
      { signal: controller.signal }
    );
    await provider.waitUntilStarted();

    controller.abort(new Error("client disconnected"));

    await expect(result).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      statusCode: 503,
      details: { reason: "aborted" }
    });
    expect(provider.signal?.aborted).toBe(true);
    expect(provider.completed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

function createService(
  provider: RestDecisionProvider,
  restDecisionTimeoutMs: number
): RestService {
  const content = new FileRestContentRepository();
  return new RestService(
    new CannedAgentLLM(),
    content,
    new InMemoryFeedbackRepository(),
    new InMemoryIdempotencyStore<unknown>(),
    provider,
    { restDecisionTimeoutMs }
  );
}

class SlightlyLateProvider implements RestDecisionProvider {
  readonly dataOrigin = "real" as const;
  private readonly started = deferred<void>();
  signal: AbortSignal | undefined;
  completed = false;

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async decide(
    _context: RestDecisionContext,
    options?: ProviderCallOptions
  ): Promise<RestDecisionCandidate> {
    this.signal = options?.signal;
    this.started.resolve();
    return new Promise<RestDecisionCandidate>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.completed = true;
        resolve({
          shouldOfferRest: false,
          reasonCode: "insufficient_signal",
          message: "",
          defaultQuestId: null
        });
      }, 101);
      options?.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(options.signal?.reason);
        },
        { once: true }
      );
    });
  }

  waitUntilStarted(): Promise<void> {
    return this.started.promise;
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

function usagePayload() {
  return {
    schema_version: "1.0",
    request_id: "req_decision_timeout",
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
