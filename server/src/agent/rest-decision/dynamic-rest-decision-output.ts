import { z } from "zod";
import { restSuggestionReasonCodeSchema } from "../../domain/contracts.js";
import type { DynamicRestDecisionCandidate } from "../../domain/ports.js";

export const dynamicGeneratedTaskSchema = z
  .object({
    title: z.string(),
    durationSeconds: z.number().int(),
    steps: z.array(z.string())
  })
  .strict();

export const dynamicRestDecisionCandidateSchema = z
  .object({
    shouldOfferRest: z.boolean(),
    reasonCode: restSuggestionReasonCodeSchema,
    message: z.string(),
    generatedTask: dynamicGeneratedTaskSchema.nullable()
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.shouldOfferRest && candidate.generatedTask === null) {
      context.addIssue({
        code: "custom",
        path: ["generatedTask"],
        message: "generatedTask must be an object when rest is offered"
      });
    }
    if (!candidate.shouldOfferRest && candidate.generatedTask !== null) {
      context.addIssue({
        code: "custom",
        path: ["generatedTask"],
        message: "generatedTask must be null when rest is not offered"
      });
    }
  });

export function parseDynamicRestDecisionModelOutput(
  output: string
): DynamicRestDecisionCandidate {
  return dynamicRestDecisionCandidateSchema.parse(JSON.parse(output));
}

export function buildDynamicRestDecisionOutputJsonSchema(): Record<
  string,
  unknown
> {
  const generatedTask = {
    type: "object",
    additionalProperties: false,
    required: ["title", "durationSeconds", "steps"],
    properties: {
      title: { type: "string" },
      durationSeconds: { type: "integer" },
      steps: {
        type: "array",
        items: { type: "string" }
      }
    }
  };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "shouldOfferRest",
      "reasonCode",
      "message",
      "generatedTask"
    ],
    properties: {
      shouldOfferRest: { type: "boolean" },
      reasonCode: {
        type: "string",
        enum: [...restSuggestionReasonCodeSchema.options]
      },
      message: { type: "string" },
      generatedTask: {
        anyOf: [generatedTask, { type: "null" }]
      }
    },
    allOf: [
      {
        if: {
          properties: {
            shouldOfferRest: { const: true }
          },
          required: ["shouldOfferRest"]
        },
        then: {
          properties: { generatedTask }
        },
        else: {
          properties: {
            generatedTask: { type: "null" }
          }
        }
      }
    ]
  };
}
