import {
  CONTRACT_VERSION,
  fatigueReflectionSchema,
  restQuestRecommendationSchema,
  type FatigueCheckIn,
  type RestQuest,
  type RestRecommendationRequest
} from "../domain/contracts.js";
import type { RestDecisionContext } from "../domain/ports.js";
import {
  buildDynamicRestDecisionOutputJsonSchema
} from "./rest-decision/dynamic-rest-decision-output.js";
import {
  buildDynamicRestDecisionModelInput,
  DYNAMIC_REST_DECISION_PROMPT_VERSION,
  DYNAMIC_REST_DECISION_SYSTEM_PROMPT
} from "./rest-decision/dynamic-rest-decision-prompt.js";

interface DynamicModeInput {
  mode: "work_state_or_rest_decision";
  context: RestDecisionContext;
}

interface ManualModeInput {
  mode: "manual_rest_quest";
  request: RestRecommendationRequest;
  allowedQuests: RestQuest[];
}

interface FatigueModeInput {
  mode: "fatigue_reflection";
  request: FatigueCheckIn;
}

interface DynamicModeRoute {
  mode: DynamicModeInput["mode"];
  promptVersion: typeof DYNAMIC_REST_DECISION_PROMPT_VERSION;
  system: string;
  input: string;
  outputSchema: Record<string, unknown>;
}

interface ManualModeRoute {
  mode: ManualModeInput["mode"];
  promptVersion: "manual-rest-quest-v1.0";
  prompt: string;
  outputSchema: typeof restQuestRecommendationSchema;
}

interface FatigueModeRoute {
  mode: FatigueModeInput["mode"];
  promptVersion: "fatigue-reflection-v1.0";
  prompt: string;
  outputSchema: typeof fatigueReflectionSchema;
}

type RestModeInput = DynamicModeInput | ManualModeInput | FatigueModeInput;
type RestModeRoute =
  | DynamicModeRoute
  | ManualModeRoute
  | FatigueModeRoute;

export function routeRestAgentMode(
  input: DynamicModeInput
): DynamicModeRoute;
export function routeRestAgentMode(input: ManualModeInput): ManualModeRoute;
export function routeRestAgentMode(input: FatigueModeInput): FatigueModeRoute;
export function routeRestAgentMode(input: RestModeInput): RestModeRoute {
  switch (input.mode) {
    case "work_state_or_rest_decision":
      return {
        mode: input.mode,
        promptVersion: DYNAMIC_REST_DECISION_PROMPT_VERSION,
        system: DYNAMIC_REST_DECISION_SYSTEM_PROMPT,
        input: buildDynamicRestDecisionModelInput(input.context),
        outputSchema: buildDynamicRestDecisionOutputJsonSchema()
      };
    case "manual_rest_quest":
      return {
        mode: input.mode,
        promptVersion: "manual-rest-quest-v1.0",
        prompt: buildManualRestQuestPrompt(
          input.request,
          input.allowedQuests
        ),
        outputSchema: restQuestRecommendationSchema
      };
    case "fatigue_reflection":
      return {
        mode: input.mode,
        promptVersion: "fatigue-reflection-v1.0",
        prompt: buildFatigueReflectionPrompt(input.request),
        outputSchema: fatigueReflectionSchema
      };
  }
}

function buildManualRestQuestPrompt(
  request: RestRecommendationRequest,
  allowedQuests: RestQuest[]
): string {
  return [
    "Select exactly one quest from the provided fixed library.",
    "Never invent a quest ID, steps, medical advice, or safety advice.",
    `schema_version must be "${CONTRACT_VERSION}", request_id must be "${request.request_id}", content_version must be "${request.content_version}".`,
    `Request: ${JSON.stringify(request)}`,
    `Allowed quests: ${JSON.stringify(
      allowedQuests.map((quest) => ({
        id: quest.id,
        fatigue_types: quest.fatigue_types,
        duration_seconds: quest.duration_seconds,
        energy_required: quest.energy_required,
        location_tags: quest.location_tags
      }))
    )}`
  ].join("\n");
}

function buildFatigueReflectionPrompt(request: FatigueCheckIn): string {
  return [
    "You classify a user's self-described tiredness for a rest product.",
    "Return JSON only. Do not diagnose a medical condition.",
    "Allowed fatigue_type: physical, sensory_overload, cognitive_overload, emotional_social, bedtime_arousal, unknown.",
    "Ask at most one follow-up. If follow_up_answer is present, needs_follow_up must be false.",
    `schema_version must be "${CONTRACT_VERSION}" and request_id must be "${request.request_id}".`,
    `Input: ${JSON.stringify(request)}`
  ].join("\n");
}
