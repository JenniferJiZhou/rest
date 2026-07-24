import { z } from "zod";
import { describe, expect, it } from "vitest";
import { classifyAgentFailure } from "../../src/agent/claude-llm.js";

describe("Claude failure classification", () => {
  it.each([
    [new SyntaxError("bad json"), "LLM_INVALID_OUTPUT", "invalid_json"],
    [
      z.string().safeParse(42).error,
      "LLM_INVALID_OUTPUT",
      "invalid_schema"
    ],
    [
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
      "LLM_TIMEOUT",
      "timeout"
    ],
    [
      Object.assign(new Error("unauthorized"), { status: 401 }),
      "INTERNAL_ERROR",
      "authentication"
    ],
    [
      Object.assign(new Error("invalid model configuration"), {
        status: 400
      }),
      "INTERNAL_ERROR",
      "configuration"
    ],
    [
      Object.assign(new Error("unavailable"), { status: 503 }),
      "INTERNAL_ERROR",
      "unavailable"
    ],
    [new Error("unexpected"), "INTERNAL_ERROR", "generic"]
  ])(
    "maps provider failures without mislabelling them as timeouts",
    async (source, code, reason) => {
      const error = classifyAgentFailure(await settle(source));

      expect(error).toMatchObject({
        code,
        details: { reason }
      });
    }
  );
});

async function settle(value: unknown): Promise<unknown> {
  try {
    return await value;
  } catch (error) {
    return error;
  }
}
