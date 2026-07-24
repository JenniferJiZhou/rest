import { z } from "zod";
import { restSuggestionReasonCodeSchema } from "../../domain/contracts.js";
import type { RestDecisionCandidate } from "../../domain/ports.js";

export const restDecisionCandidateSchema = z
  .object({
    shouldOfferRest: z.boolean(),
    reasonCode: restSuggestionReasonCodeSchema,
    message: z.string().max(240),
    defaultQuestId: z.string().nullable()
  })
  .strict()
  .superRefine((candidate, context) => {
    if (!candidate.shouldOfferRest) {
      if (candidate.message !== "") {
        context.addIssue({
          code: "custom",
          path: ["message"],
          message: "A no-offer candidate must have an empty message."
        });
      }
      if (candidate.defaultQuestId !== null) {
        context.addIssue({
          code: "custom",
          path: ["defaultQuestId"],
          message: "A no-offer candidate must not select a Quest."
        });
      }
      if (
        !["cooldown", "insufficient_signal"].includes(
          candidate.reasonCode
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["reasonCode"],
          message: "A no-offer candidate must use a no-offer reason."
        });
      }
      return;
    }
    if (candidate.message.trim().length === 0) {
      context.addIssue({
        code: "custom",
        path: ["message"],
        message: "An offer candidate must have a message."
      });
    }
    if (candidate.defaultQuestId === null) {
      context.addIssue({
        code: "custom",
        path: ["defaultQuestId"],
        message: "An offer candidate must select an allowed Quest."
      });
    }
  });

export function parseRestDecisionModelOutput(
  output: string,
  allowedQuestIds: string[]
): RestDecisionCandidate {
  const candidate = restDecisionCandidateSchema.parse(
    JSON.parse(output)
  );
  if (
    candidate.defaultQuestId !== null &&
    !allowedQuestIds.includes(candidate.defaultQuestId)
  ) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["defaultQuestId"],
        message: "Quest is not in the fixed allowlist."
      }
    ]);
  }
  return candidate;
}

export function buildRestDecisionOutputJsonSchema(
  allowedQuestIds: string[],
  maximumMessageCharacters: number
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "shouldOfferRest",
      "reasonCode",
      "message",
      "defaultQuestId"
    ],
    properties: {
      shouldOfferRest: { type: "boolean" },
      reasonCode: {
        type: "string",
        enum: [...restSuggestionReasonCodeSchema.options]
      },
      message: {
        type: "string",
        maxLength: maximumMessageCharacters
      },
      defaultQuestId: {
        anyOf: [
          { type: "string", enum: [...allowedQuestIds] },
          { type: "null" }
        ]
      }
    }
  };
}
