import {
  CONTRACT_VERSION,
  fatigueReflectionSchema,
  restQuestRecommendationSchema,
  type FatigueCheckIn,
  type FatigueReflection,
  type RestQuest,
  type RestQuestRecommendation,
  type RestRecommendationRequest
} from "../domain/contracts.js";
import type {
  AgentLLM,
  DataOrigin,
  HandoffAgentInput,
  HandoffSummaryDraft,
  ProviderCallOptions,
  ProviderHealth
} from "../domain/ports.js";
import { AppError } from "../domain/errors.js";

const includesAny = (text: string, words: string[]): boolean =>
  words.some((word) => text.includes(word));

export class CannedAgentLLM implements AgentLLM {
  readonly dataOrigin: DataOrigin = "mock";

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async reflectFatigue(
    input: FatigueCheckIn,
    options?: ProviderCallOptions
  ): Promise<FatigueReflection> {
    assertNotAborted(options);
    const description = input.description.toLowerCase();
    const hasFollowUpAnswer =
      input.follow_up_answer !== null &&
      input.follow_up_answer !== undefined;
    const needsFollowUp =
      !hasFollowUpAnswer &&
      !includesAny(description, [
        "眼",
        "屏幕",
        "头",
        "肩",
        "腰",
        "身体",
        "困",
        "睡",
        "烦",
        "焦虑",
        "社交",
        "脑",
        "想不动",
        "卡住"
      ]);

    let fatigueType: FatigueReflection["fatigue_type"] = "unknown";
    let reflection = "你现在的疲惫还不够明确，可以先选择最接近的一种感受。";

    if (includesAny(description, ["眼", "屏幕", "亮", "吵", "感官"])) {
      fatigueType = "sensory_overload";
      reflection = "更像是感官接收过多，先让眼睛和注意力离开屏幕。";
    } else if (
      includesAny(description, ["肩", "腰", "身体", "僵", "酸", "疼"])
    ) {
      fatigueType = "physical";
      reflection = "更像是身体疲劳，短暂起身和轻柔活动会比继续坐着更合适。";
    } else if (includesAny(description, ["困", "睡", "夜", "入睡"])) {
      fatigueType = "bedtime_arousal";
      reflection = "身体可能已经需要睡眠，先减少刺激并为结束今天做交接。";
    } else if (
      includesAny(description, ["烦", "焦虑", "委屈", "社交", "情绪"])
    ) {
      fatigueType = "emotional_social";
      reflection = "这更像情绪或社交消耗，先给自己一段不需要回应任何人的时间。";
    } else if (
      includesAny(description, ["脑", "想不动", "卡住", "乱", "注意力"])
    ) {
      fatigueType = "cognitive_overload";
      reflection = "更像认知负荷过高，先把未完成事项放下，再离开当前任务。";
    } else if (hasFollowUpAnswer) {
      const answer = (input.follow_up_answer ?? "").toLowerCase();
      if (includesAny(answer, ["身体", "酸", "僵", "肩", "腰", "疼"])) {
        fatigueType = "physical";
      } else if (
        includesAny(answer, ["情绪", "烦", "焦虑", "社交", "委屈"])
      ) {
        fatigueType = "emotional_social";
      } else if (
        includesAny(answer, ["眼", "屏幕", "亮", "吵", "感官"])
      ) {
        fatigueType = "sensory_overload";
      } else if (includesAny(answer, ["困", "睡", "夜", "入睡"])) {
        fatigueType = "bedtime_arousal";
      } else if (
        includesAny(answer, ["脑", "想不动", "卡住", "注意力", "转不动"])
      ) {
        fatigueType = "cognitive_overload";
      }
      reflection =
        fatigueType === "unknown"
          ? "信息仍然不够明确，先选择一个低负担、可随时停止的恢复动作。"
          : "先选择一个低负担、可随时停止的恢复动作。";
    }

    return fatigueReflectionSchema.parse({
      schema_version: CONTRACT_VERSION,
      request_id: input.request_id,
      fatigue_type: fatigueType,
      reflection,
      needs_follow_up: needsFollowUp,
      follow_up: needsFollowUp
        ? {
            question: "这种累更接近哪一种？",
            options: ["身体发紧", "脑子转不动", "情绪被耗尽"]
          }
        : null,
      safety_notice: null
    });
  }

  async chooseQuest(
    input: RestRecommendationRequest,
    allowedQuests: RestQuest[],
    options?: ProviderCallOptions
  ): Promise<RestQuestRecommendation> {
    assertNotAborted(options);
    const selected =
      allowedQuests.find((quest) =>
        quest.fatigue_types.includes(input.fatigue_type)
      ) ?? allowedQuests[0];

    if (!selected) {
      throw new Error("No eligible rest quest is available.");
    }

    return restQuestRecommendationSchema.parse({
      schema_version: CONTRACT_VERSION,
      request_id: input.request_id,
      content_version: input.content_version,
      quest_id: selected.id,
      reason_code: `matches_${input.fatigue_type}`,
      intro: "先做一个短而有明确终点的恢复动作。",
      fallback_quest_id: allowedQuests[1]?.id ?? null
    });
  }

  async summarizeHandoff(
    input: HandoffAgentInput,
    options?: ProviderCallOptions
  ): Promise<HandoffSummaryDraft> {
    assertNotAborted(options);
    const classifications = input.mail.map((mail) => {
      const content = `${mail.subject}\n${mail.plainText}`.toLowerCase();
      const tonight = includesAny(content, [
        "今晚",
        "立即",
        "现在",
        "紧急",
        "故障",
        "宕机"
      ]);
      const uncertain =
        !tonight &&
        !includesAny(content, [
          "明天",
          "无需回复",
          "通知",
          "newsletter",
          "账单"
        ]);
      const noAction =
        !tonight &&
        includesAny(content, ["无需回复", "通知", "newsletter", "自动发送"]);
      const priority = tonight
        ? "tonight_required"
        : noAction
          ? "no_action"
          : uncertain
            ? "uncertain"
            : "tomorrow";

      return {
        id: mail.id,
        priority,
        gist: mail.subject || "未命名邮件",
        reason: tonight
          ? "内容包含明确的即时性信号。"
          : noAction
            ? "内容看起来是无需回复的通知。"
            : uncertain
              ? "没有足够信息安全判断处理时机。"
              : "内容允许明天再处理。",
        suggestedDraft:
          priority === "tomorrow" || priority === "tonight_required"
            ? "收到，谢谢。我会在合适的时间确认并回复。"
            : null
      } as const;
    });

    return {
      classifications,
      tomorrowFirstStep:
        input.request.open_loops[0]?.text ??
        classifications.find((item) => item.priority === "tomorrow")?.gist ??
        null
    };
  }
}

function assertNotAborted(options?: ProviderCallOptions): void {
  if (!options?.signal?.aborted) {
    return;
  }
  throw new AppError({
    code: "INTERNAL_ERROR",
    message: "Agent operation was aborted.",
    statusCode: 503,
    retryable: false,
    fallback: "LOCAL_RULES",
    details: { reason: "aborted" }
  });
}
