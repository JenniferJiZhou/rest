import { describe, expect, it } from "vitest";
import {
  DynamicRestDecisionProvider
} from "../../src/agent/rest-decision/dynamic-rest-decision-provider.js";
import type {
  RestDecisionModelClient,
  RestDecisionModelRequest
} from "../../src/agent/rest-decision/rest-decision-model-client.js";
import type {
  ProviderCallOptions,
  RestDecisionContext
} from "../../src/domain/ports.js";

describe("DynamicRestDecisionProvider", () => {
  it("returns a generated task without Quest input or server-owned fields", async () => {
    const client = new FakeModelClient(
      JSON.stringify({
        shouldOfferRest: true,
        reasonCode: "long_continuous_use",
        message: "现在可以暂时把注意力从屏幕上移开。",
        generatedTask: {
          title: "一分钟桌边重置",
          durationSeconds: 60,
          steps: ["双手离开键盘", "看向远处", "放松肩膀"]
        }
      })
    );
    const provider = new DynamicRestDecisionProvider(
      client,
      "step-3.7-flash"
    );

    await expect(provider.decide(context())).resolves.toEqual({
      shouldOfferRest: true,
      reasonCode: "long_continuous_use",
      message: "现在可以暂时把注意力从屏幕上移开。",
      generatedTask: {
        title: "一分钟桌边重置",
        durationSeconds: 60,
        steps: ["双手离开键盘", "看向远处", "放松肩膀"]
      }
    });
    const request = client.requests[0]!;
    expect(request.model).toBe("step-3.7-flash");
    expect(request.system).not.toContain("allowedQuestIds");
    expect(request.input).not.toContain("allowedQuestIds");
    expect(request.outputSchema).not.toHaveProperty(
      "properties.defaultQuestId"
    );
  });

  it("accepts a non-empty companion message when no rest is offered", async () => {
    const provider = providerWith({
      shouldOfferRest: false,
      reasonCode: "insufficient_signal",
      message: "先照着现在的节奏继续，我在这里陪你。",
      generatedTask: null
    });

    await expect(provider.decide(context())).resolves.toEqual({
      shouldOfferRest: false,
      reasonCode: "insufficient_signal",
      message: "先照着现在的节奏继续，我在这里陪你。",
      generatedTask: null
    });
  });

  it.each([
    ["malformed JSON", '{"shouldOfferRest":'],
    [
      "a missing required field",
      JSON.stringify({
        shouldOfferRest: false,
        reasonCode: "insufficient_signal",
        message: "继续保持现在的节奏。"
      })
    ],
    [
      "an invalid field type",
      JSON.stringify({
        shouldOfferRest: true,
        reasonCode: "long_continuous_use",
        message: "稍微停一下。",
        generatedTask: {
          title: "桌边重置",
          durationSeconds: "60",
          steps: ["看向远处"]
        }
      })
    ],
    [
      "a missing task on an offer",
      JSON.stringify({
        shouldOfferRest: true,
        reasonCode: "long_continuous_use",
        message: "稍微停一下。",
        generatedTask: null
      })
    ],
    [
      "a task on a no-offer response",
      JSON.stringify({
        shouldOfferRest: false,
        reasonCode: "insufficient_signal",
        message: "继续保持现在的节奏。",
        generatedTask: {
          title: "",
          durationSeconds: -1,
          steps: []
        }
      })
    ]
  ])("rejects %s as a structural model error", async (_case, output) => {
    await expect(
      new DynamicRestDecisionProvider(
        new FakeModelClient(output),
        "step-3.7-flash"
      ).decide(context())
    ).rejects.toMatchObject({
      code: "LLM_INVALID_OUTPUT",
      statusCode: 503
    });
  });
});

function providerWith(output: Record<string, unknown>) {
  return new DynamicRestDecisionProvider(
    new FakeModelClient(JSON.stringify(output)),
    "step-3.7-flash"
  );
}

class FakeModelClient implements RestDecisionModelClient {
  readonly requests: RestDecisionModelRequest[] = [];

  constructor(private readonly output: string) {}

  async complete(
    request: RestDecisionModelRequest,
    _options?: ProviderCallOptions
  ): Promise<string> {
    this.requests.push(structuredClone(request));
    return this.output;
  }
}

function context(): RestDecisionContext {
  return {
    requestId: "req_dynamic_provider",
    measuredAt: "2026-07-25T04:00:00Z",
    source: {
      platform: "ios",
      triggerSource: "device_activity_threshold",
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
      dailyMinutes: 120,
      continuousMinutes: 45,
      continuousIsEstimated: true
    },
    appSwitchesLast10Minutes: 2,
    localHour: 15,
    minutesSinceLastRest: 8,
    selfReportedEnergy: null,
    recentFeedback: ["right"],
    outputConstraints: {
      maximumMessageCharacters: 240,
      mayControlDevice: false,
      mayChangeNextThreshold: false
    }
  };
}
