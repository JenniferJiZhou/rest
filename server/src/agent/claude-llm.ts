import Anthropic from "@anthropic-ai/sdk";
import { ZodError, type ZodType } from "zod";
import {
  type FatigueCheckIn,
  type FatigueReflection,
  type RestQuest,
  type RestQuestRecommendation,
  type RestRecommendationRequest
} from "../domain/contracts.js";
import { AppError } from "../domain/errors.js";
import { routeRestAgentMode } from "./rest-mode-router.js";
import type {
  AgentLLM,
  DataOrigin,
  HandoffAgentInput,
  HandoffSummaryDraft,
  ProviderCallOptions,
  ProviderHealth
} from "../domain/ports.js";
import { z } from "zod";

const handoffDraftSchema = z
  .object({
    classifications: z.array(
      z
        .object({
          id: z.string(),
          priority: z.enum([
            "tonight_required",
            "tomorrow",
            "no_action",
            "uncertain"
          ]),
          gist: z.string().max(240),
          reason: z.string().max(240),
          suggestedDraft: z.string().max(1000).nullable()
        })
        .strict()
    ),
    tomorrowFirstStep: z.string().max(300).nullable()
  })
  .strict();

export class ClaudeAgentLLM implements AgentLLM {
  readonly dataOrigin: DataOrigin = "real";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async reflectFatigue(
    input: FatigueCheckIn,
    options?: ProviderCallOptions
  ): Promise<FatigueReflection> {
    const route = routeRestAgentMode({
      mode: "fatigue_reflection",
      request: input
    });
    return this.completeJson(
      route.prompt,
      route.outputSchema,
      options
    );
  }

  async chooseQuest(
    input: RestRecommendationRequest,
    allowedQuests: RestQuest[],
    options?: ProviderCallOptions
  ): Promise<RestQuestRecommendation> {
    const route = routeRestAgentMode({
      mode: "manual_rest_quest",
      request: input,
      allowedQuests
    });
    return this.completeJson(
      route.prompt,
      route.outputSchema,
      options
    );
  }

  async summarizeHandoff(
    input: HandoffAgentInput,
    options?: ProviderCallOptions
  ): Promise<HandoffSummaryDraft> {
    return this.completeJson(
      [
        "Classify each provided email for a sleep handoff.",
        "Return JSON only. Every mail ID must appear exactly once.",
        "Allowed priority: tonight_required, tomorrow, no_action, uncertain.",
        "Use tonight_required only when the text contains a concrete reason it cannot wait.",
        "Use uncertain when evidence is insufficient. Never claim a draft was saved.",
        "A suggestedDraft is only proposed text; the application decides whether it is written.",
        `Input: ${JSON.stringify(input)}`
      ].join("\n"),
      handoffDraftSchema,
      options
    );
  }

  private async completeJson<T>(
    prompt: string,
    schema: ZodType<T>,
    options?: ProviderCallOptions
  ): Promise<T> {
    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 1800,
          temperature: 0,
          messages: [{ role: "user", content: prompt }]
        },
        { signal: options?.signal }
      );
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      const candidate = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");
      return schema.parse(JSON.parse(candidate));
    } catch (error) {
      throw classifyAgentFailure(error);
    }
  }
}

export function classifyAgentFailure(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof SyntaxError) {
    return agentError(
      "LLM_INVALID_OUTPUT",
      "Model output was not valid JSON.",
      "invalid_json",
      true,
      error
    );
  }
  if (error instanceof ZodError) {
    return agentError(
      "LLM_INVALID_OUTPUT",
      "Model output did not match the required schema.",
      "invalid_schema",
      true,
      error
    );
  }

  const status = errorStatus(error);
  const name = errorStringProperty(error, "name");
  const code = errorStringProperty(error, "code");
  if (
    name.includes("timeout") ||
    code.includes("timeout") ||
    code === "etimedout"
  ) {
    return agentError(
      "LLM_TIMEOUT",
      "Model provider timed out.",
      "timeout",
      true,
      error
    );
  }
  if (status === 401 || status === 403) {
    return agentError(
      "INTERNAL_ERROR",
      "Model provider authentication failed.",
      "authentication",
      false,
      error
    );
  }
  if (status === 400 || status === 404) {
    return agentError(
      "INTERNAL_ERROR",
      "Model provider configuration is invalid.",
      "configuration",
      false,
      error
    );
  }
  if (
    status === 429 ||
    (status !== undefined && status >= 500) ||
    ["econnreset", "econnrefused", "enotfound"].includes(code)
  ) {
    return agentError(
      "INTERNAL_ERROR",
      "Model provider is unavailable.",
      "unavailable",
      true,
      error
    );
  }
  return agentError(
    "INTERNAL_ERROR",
    "Model provider failed unexpectedly.",
    "generic",
    true,
    error
  );
}

function agentError(
  code: "LLM_INVALID_OUTPUT" | "LLM_TIMEOUT" | "INTERNAL_ERROR",
  message: string,
  reason: string,
  retryable: boolean,
  cause: unknown
): AppError {
  return new AppError({
    code,
    message,
    statusCode: 503,
    retryable,
    fallback: "LOCAL_RULES",
    details: { reason },
    cause
  });
}

function errorStringProperty(
  error: unknown,
  property: "name" | "code"
): string {
  if (
    typeof error !== "object" ||
    error === null ||
    !(property in error)
  ) {
    return "";
  }
  const value = (error as Record<string, unknown>)[property];
  return typeof value === "string" ? value.toLowerCase() : "";
}

function errorStatus(error: unknown): number | undefined {
  if (
    typeof error !== "object" ||
    error === null ||
    !("status" in error)
  ) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
}
