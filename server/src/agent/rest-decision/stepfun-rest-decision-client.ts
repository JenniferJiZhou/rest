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
    const response = await this.fetcher(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        instructions: request.system,
        input: request.input,
        stream: false,
        text: {
          format: {
            type: "json_schema",
            name: "dynamic_rest_decision",
            strict: true,
            schema: request.outputSchema
          }
        }
      }),
      ...(options?.signal ? { signal: options.signal } : {})
    });
    if (!response.ok) {
      throw providerHttpError(response.status);
    }
    const payload = (await response.json()) as unknown;
    const output = extractOutputText(payload);
    if (output === null) {
      throw new SyntaxError(
        "StepFun response did not contain completed output text."
      );
    }
    return output.trim();
  }
}

function extractOutputText(payload: unknown): string | null {
  if (!isRecord(payload) || payload.status !== "completed") {
    return null;
  }
  const output = payload.output;
  if (!Array.isArray(output)) {
    return null;
  }
  const texts: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (
        isRecord(content) &&
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        texts.push(content.text);
      }
    }
  }
  return texts.length > 0 ? texts.join("") : null;
}

function providerHttpError(status: number): Error & { status: number } {
  return Object.assign(new Error("StepFun request failed."), { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
