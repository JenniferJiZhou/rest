import { describe, expect, it } from "vitest";
import {
  CannedDynamicRestDecisionProvider,
  CannedRestDecisionProvider,
  UnavailableDynamicRestDecisionProvider,
  UnavailableRestDecisionProvider
} from "../../src/agent/rest-decision-providers.js";
import { FileRestContentRepository } from "../../src/content/file-rest-content-repository.js";
import type { RestDecisionContext } from "../../src/domain/ports.js";

const content = new FileRestContentRepository();

const context = (
  overrides: Partial<RestDecisionContext> = {}
): RestDecisionContext => ({
  requestId: "req_provider_contract",
  measuredAt: "2026-07-24T04:00:00Z",
  source: {
    platform: "ios",
    triggerSource: "device_activity_threshold",
    targetType: "app"
  },
  monitoredContext: {
    userProvidedLabel: "用户命名",
    labelSource: "user",
    rawAppIdentityAvailable: false,
    websiteDomain: null,
    fullUrlAvailable: false,
    pageTitleAvailable: false
  },
  usage: {
    dailyMinutes: 35,
    continuousMinutes: 30,
    continuousIsEstimated: true
  },
  appSwitchesLast10Minutes: null,
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
});

describe("RestDecisionProvider contract", () => {
  it("exposes Canned as a ready mock Provider", async () => {
    const provider = new CannedRestDecisionProvider(content);

    expect(provider.dataOrigin).toBe("mock");
    await expect(provider.health()).resolves.toBe("ready");
  });

  it("returns deterministic Canned decisions", async () => {
    const provider = new CannedRestDecisionProvider(content);

    await expect(provider.decide(context())).resolves.toEqual(
      await provider.decide(context())
    );
  });

  it("selects a Quest only from the fixed repository", async () => {
    const provider = new CannedRestDecisionProvider(content);
    const candidate = await provider.decide(context());

    expect(candidate.defaultQuestId).toBeTruthy();
    expect(content.questById(candidate.defaultQuestId!)).toBeDefined();
  });

  it("exposes Unavailable as unavailable mock infrastructure", async () => {
    const provider = new UnavailableRestDecisionProvider();

    expect(provider.dataOrigin).toBe("mock");
    await expect(provider.health()).resolves.toBe("unavailable");
    await expect(provider.decide(context())).rejects.toThrow(
      "Rest Decision Provider is unavailable."
    );
  });

  it("returns a Canned Contract 1.1 generated task as mock data", async () => {
    const provider = new CannedDynamicRestDecisionProvider();
    const candidate = await provider.decide(context());

    expect(provider.dataOrigin).toBe("mock");
    expect(candidate).toMatchObject({
      shouldOfferRest: true,
      generatedTask: {
        title: expect.any(String),
        durationSeconds: expect.any(Number),
        steps: expect.any(Array)
      }
    });
    expect(candidate).not.toHaveProperty("defaultQuestId");
  });

  it("returns a Canned Contract 1.1 companion state", async () => {
    const provider = new CannedDynamicRestDecisionProvider();
    const candidate = await provider.decide(
      context({
        usage: {
          dailyMinutes: 5,
          continuousMinutes: 5,
          continuousIsEstimated: true
        }
      })
    );

    expect(candidate).toEqual({
      shouldOfferRest: false,
      reasonCode: "insufficient_signal",
      message: "先照着现在的节奏继续，我在这里陪你。",
      generatedTask: null
    });
  });

  it("keeps dynamic Unavailable separate from a RestSuggestion", async () => {
    const provider = new UnavailableDynamicRestDecisionProvider();

    await expect(provider.health()).resolves.toBe("unavailable");
    await expect(provider.decide(context())).rejects.toThrow(
      "Dynamic Rest Decision Provider is unavailable."
    );
  });
});
