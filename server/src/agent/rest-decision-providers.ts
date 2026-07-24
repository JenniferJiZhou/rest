import type {
  ProviderCallOptions,
  ProviderHealth,
  RestContentRepository,
  RestDecisionCandidate,
  RestDecisionContext,
  RestDecisionProvider
} from "../domain/ports.js";

export class CannedRestDecisionProvider
  implements RestDecisionProvider
{
  readonly dataOrigin = "mock" as const;

  constructor(private readonly content: RestContentRepository) {}

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async decide(
    context: RestDecisionContext,
    _options?: ProviderCallOptions
  ): Promise<RestDecisionCandidate> {
    const questId = this.content.quests()[0]?.id ?? null;
    const manual = [
      "manual_ios",
      "manual_macos",
      "notification",
      "debug"
    ].includes(context.source.triggerSource);

    if (manual) {
      return offer(
        "manual",
        "可以。先说说你现在更像是哪一种累。",
        questId
      );
    }
    if (
      context.selfReportedEnergy !== null &&
      context.selfReportedEnergy <= 2
    ) {
      return offer(
        "low_energy",
        "你的精力已经偏低，先做一个短而明确的恢复动作。",
        questId
      );
    }
    if (context.localHour >= 23 || context.localHour <= 5) {
      return offer(
        "late_hour",
        "现在已经很晚，可以先把未完成事项安置好。",
        questId
      );
    }
    if ((context.appSwitchesLast10Minutes ?? 0) >= 10) {
      return offer(
        "attention_fragmentation",
        "刚才的切换比较频繁，可以先离开屏幕一小会儿。",
        questId
      );
    }
    if (context.usage.continuousMinutes >= 20) {
      return offer(
        "long_continuous_use",
        context.usage.continuousIsEstimated
          ? "估算的持续使用时间已经较长，可以先暂停几分钟。"
          : "这段持续使用时间已经较长，可以先暂停几分钟。",
        questId
      );
    }
    if ((context.usage.dailyMinutes ?? 0) >= 45) {
      return offer(
        "insufficient_signal",
        "今天累计使用时间已经较长，如果方便，可以做一个短休息。",
        questId
      );
    }
    return {
      shouldOfferRest: false,
      reasonCode: "insufficient_signal",
      message: "",
      defaultQuestId: null
    };
  }
}

export class UnavailableRestDecisionProvider
  implements RestDecisionProvider
{
  readonly dataOrigin = "mock" as const;

  async health(): Promise<ProviderHealth> {
    return "unavailable";
  }

  async decide(
    _context: RestDecisionContext,
    _options?: ProviderCallOptions
  ): Promise<RestDecisionCandidate> {
    throw new Error("Rest Decision Provider is unavailable.");
  }
}

function offer(
  reasonCode: RestDecisionCandidate["reasonCode"],
  message: string,
  defaultQuestId: string | null
): RestDecisionCandidate {
  return {
    shouldOfferRest: true,
    reasonCode,
    message,
    defaultQuestId
  };
}
