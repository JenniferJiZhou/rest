import { classifyAgentFailure } from "../claude-llm.js";
import { routeRestAgentMode } from "../rest-mode-router.js";
import type {
  DynamicRestDecisionCandidate,
  ProviderCallOptions,
  ProviderHealth,
  RestDecisionContext,
  RestDecisionProvider
} from "../../domain/ports.js";
import {
  parseDynamicRestDecisionModelOutput
} from "./dynamic-rest-decision-output.js";
import type {
  RestDecisionModelClient
} from "./rest-decision-model-client.js";

export class DynamicRestDecisionProvider
  implements RestDecisionProvider<DynamicRestDecisionCandidate>
{
  readonly dataOrigin = "real" as const;
  readonly configurationHealth = "ready" as const;

  constructor(
    private readonly client: RestDecisionModelClient,
    private readonly model: string
  ) {}

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async decide(
    context: RestDecisionContext,
    options?: ProviderCallOptions
  ): Promise<DynamicRestDecisionCandidate> {
    const route = routeRestAgentMode({
      mode: "work_state_or_rest_decision",
      context
    });
    try {
      const output = await this.client.complete(
        {
          model: this.model,
          system: route.system,
          input: route.input,
          outputSchema: route.outputSchema
        },
        options
      );
      return parseDynamicRestDecisionModelOutput(output);
    } catch (error) {
      throw classifyAgentFailure(error);
    }
  }
}
