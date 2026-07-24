import type {
  FatigueCheckIn,
  FatigueReflection,
  RestQuest,
  RestQuestRecommendation,
  RestRecommendationRequest
} from "../domain/contracts.js";
import type {
  AgentLLM,
  DataOrigin,
  HandoffAgentInput,
  HandoffSummaryDraft,
  ProviderCallOptions,
  ProviderHealth
} from "../domain/ports.js";

export class ResilientAgentLLM implements AgentLLM {
  constructor(
    private readonly primary: AgentLLM,
    private readonly fallback: AgentLLM
  ) {}

  get dataOrigin(): DataOrigin {
    return this.primary.dataOrigin === "real" &&
      this.fallback.dataOrigin === "real"
      ? "real"
      : "mock";
  }

  async health(): Promise<ProviderHealth> {
    const health = await this.primary.health();
    return health === "ready" ? "ready" : "degraded";
  }

  async reflectFatigue(
    input: FatigueCheckIn,
    options?: ProviderCallOptions
  ): Promise<FatigueReflection> {
    return this.withFallback(
      () => this.primary.reflectFatigue(input, options),
      () => this.fallback.reflectFatigue(input, options),
      options
    );
  }

  async chooseQuest(
    input: RestRecommendationRequest,
    allowedQuests: RestQuest[],
    options?: ProviderCallOptions
  ): Promise<RestQuestRecommendation> {
    return this.withFallback(
      () => this.primary.chooseQuest(input, allowedQuests, options),
      () => this.fallback.chooseQuest(input, allowedQuests, options),
      options
    );
  }

  async summarizeHandoff(
    input: HandoffAgentInput,
    options?: ProviderCallOptions
  ): Promise<HandoffSummaryDraft> {
    return this.withFallback(
      () => this.primary.summarizeHandoff(input, options),
      () => this.fallback.summarizeHandoff(input, options),
      options
    );
  }

  private async withFallback<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
    options?: ProviderCallOptions
  ): Promise<T> {
    try {
      return await primary();
    } catch (error) {
      if (options?.signal?.aborted) {
        throw error;
      }
      return fallback();
    }
  }
}
