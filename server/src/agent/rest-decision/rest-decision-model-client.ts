import type { ProviderCallOptions } from "../../domain/ports.js";

export interface RestDecisionModelRequest {
  model: string;
  system: string;
  input: string;
  outputSchema: Record<string, unknown>;
}

export interface RestDecisionModelClient {
  complete(
    request: RestDecisionModelRequest,
    options?: ProviderCallOptions
  ): Promise<string>;
}
