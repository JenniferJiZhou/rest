import type { ProviderCallOptions } from "../../domain/ports.js";
import type {
  RestDecisionModelClient,
  RestDecisionModelRequest
} from "./rest-decision-model-client.js";

export class StepFunRestDecisionClient
  implements RestDecisionModelClient
{
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    baseUrl: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
  }

  async complete(
    request: RestDecisionModelRequest,
    options?: ProviderCallOptions
  ): Promise<string> {
    const response = await this.fetcher(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.input }
          ],
          response_format: { type: "json_object" },
          stream: false
        }),
        ...(options?.signal ? { signal: options.signal } : {})
      }
    );
    if (!response.ok) {
      throw providerHttpError(response.status);
    }
    const payload = (await response.json()) as unknown;
    const output = extractMessageContent(payload);
    if (output === null) {
      throw new SyntaxError(
        "StepFun response did not contain assistant message content."
      );
    }
    return output.trim();
  }
}

function extractMessageContent(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return null;
  }
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    return null;
  }
  return typeof choice.message.content === "string"
    ? choice.message.content
    : null;
}

function providerHttpError(status: number): Error & { status: number } {
  return Object.assign(new Error("StepFun request failed."), { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
