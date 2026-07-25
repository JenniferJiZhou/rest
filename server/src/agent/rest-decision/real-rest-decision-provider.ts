import Anthropic from "@anthropic-ai/sdk";
import { classifyAgentFailure } from "../claude-llm.js";
import type {
  ProviderCallOptions,
  ProviderHealth,
  RestContentRepository,
  RestDecisionCandidate,
  RestDecisionContext,
  RestDecisionProvider
} from "../../domain/ports.js";
import {
  buildRestDecisionModelInput,
  REST_DECISION_SYSTEM_PROMPT
} from "./rest-decision-prompt.js";
import {
  buildRestDecisionOutputJsonSchema,
  parseRestDecisionModelOutput
} from "./rest-decision-output.js";
import type {
  RestDecisionModelClient,
  RestDecisionModelRequest
} from "./rest-decision-model-client.js";
export type {
  RestDecisionModelClient,
  RestDecisionModelRequest
} from "./rest-decision-model-client.js";

interface AnthropicRestDecisionApi {
  messages: {
    create(
      body: {
        model: string;
        max_tokens: number;
        temperature: number;
        system: string;
        messages: Array<{
          role: "user";
          content: string;
        }>;
        output_config: {
          format: {
            type: "json_schema";
            schema: Record<string, unknown>;
          };
        };
      },
      options?: { signal?: AbortSignal }
    ): Promise<{
      content: Array<
        | { type: "text"; text: string }
        | { type: string; [key: string]: unknown }
      >;
    }>;
  };
}

export class AnthropicRestDecisionModelClient
  implements RestDecisionModelClient
{
  private readonly client: AnthropicRestDecisionApi;

  constructor(
    apiKey: string,
    baseURL: string,
    client?: AnthropicRestDecisionApi
  ) {
    this.client =
      client ??
      (new Anthropic({
        apiKey,
        baseURL
      }) as unknown as AnthropicRestDecisionApi);
  }

  async complete(
    request: RestDecisionModelRequest,
    options?: ProviderCallOptions
  ): Promise<string> {
    const response = await this.client.messages.create(
      {
        model: request.model,
        max_tokens: 512,
        temperature: 0,
        system: request.system,
        messages: [{ role: "user", content: request.input }],
        output_config: {
          format: {
            type: "json_schema",
            schema: request.outputSchema
          }
        }
      },
      options?.signal ? { signal: options.signal } : {}
    );
    return response.content
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text" &&
          typeof block.text === "string"
      )
      .map((block) => block.text)
      .join("")
      .trim();
  }
}

export class RealRestDecisionProvider
  implements RestDecisionProvider
{
  readonly dataOrigin = "real" as const;

  constructor(
    private readonly client: RestDecisionModelClient,
    private readonly model: string,
    private readonly content: RestContentRepository
  ) {}

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async decide(
    context: RestDecisionContext,
    options?: ProviderCallOptions
  ): Promise<RestDecisionCandidate> {
    const allowedQuestIds = this.content
      .quests()
      .map((quest) => quest.id);
    const input = buildRestDecisionModelInput(
      context,
      allowedQuestIds
    );
    try {
      const output = await this.client.complete(
        {
          model: this.model,
          system: REST_DECISION_SYSTEM_PROMPT,
          input: JSON.stringify(input),
          outputSchema: buildRestDecisionOutputJsonSchema(
            allowedQuestIds,
            context.outputConstraints.maximumMessageCharacters
          )
        },
        options
      );
      return parseRestDecisionModelOutput(output, allowedQuestIds);
    } catch (error) {
      throw classifyAgentFailure(error);
    }
  }
}
