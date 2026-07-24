import { describe, expect, it } from "vitest";
import { CannedAgentLLM } from "../../src/agent/canned-llm.js";

describe("CannedAgentLLM safe follow-up fallback", () => {
  it.each([
    "我不知道",
    "说不上来",
    "不确定",
    "随便",
    "今天天气普通",
    "……？！",
    "就是有一点累",
    ""
  ])("keeps an ambiguous follow-up as unknown: %j", async (answer) => {
    const result = await new CannedAgentLLM().reflectFatigue({
      schema_version: "1.0",
      request_id: `req_ambiguous_${answer.length}`,
      session_id: "session_ambiguous",
      source: "manual_ios",
      description: "说不清是哪种累",
      input_mode: "text",
      available_minutes: 3,
      willing_to_move: null,
      current_place: "desk",
      follow_up_answer: answer
    });

    expect(result.fatigue_type).toBe("unknown");
    expect(result.needs_follow_up).toBe(false);
    expect(result.follow_up).toBeNull();
  });

  it("uses cognitive_overload only for an explicit cognitive signal", async () => {
    const result = await new CannedAgentLLM().reflectFatigue({
      schema_version: "1.0",
      request_id: "req_explicit_cognitive",
      session_id: "session_explicit_cognitive",
      source: "manual_ios",
      description: "说不清是哪种累",
      input_mode: "text",
      available_minutes: 3,
      willing_to_move: null,
      current_place: "desk",
      follow_up_answer: "脑子转不动，注意力很乱"
    });

    expect(result.fatigue_type).toBe("cognitive_overload");
    expect(result.needs_follow_up).toBe(false);
  });
});
