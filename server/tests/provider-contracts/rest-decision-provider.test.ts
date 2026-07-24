import { describe, expect, it } from "vitest";
import {
  CannedRestDecisionProvider,
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
});
