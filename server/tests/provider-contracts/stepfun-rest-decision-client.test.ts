import { describe, expect, it, vi } from "vitest";
import { StepFunRestDecisionClient } from "../../src/agent/rest-decision/stepfun-rest-decision-client.js";
import {
  buildDynamicManualRestOutputJsonSchema,
  buildDynamicRestDecisionOutputJsonSchema
} from "../../src/agent/rest-decision/dynamic-rest-decision-output.js";

describe("StepFunRestDecisionClient", () => {
  it("uses non-streaming Chat Completions JSON mode with the selected Mode A schema", async () => {
    const calls: Array<{
      input: string | URL | Request;
      init?: RequestInit;
    }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({
        input,
        ...(init === undefined ? {} : { init })
      });
      return chatCompletion(
        '{"shouldOfferRest":false,"reasonCode":"insufficient_signal","message":"继续当前节奏。","generatedTask":null}'
      );
    };
    const client = new StepFunRestDecisionClient(
      "step-secret-for-test",
      "https://api.stepfun.example/v1/",
      fetcher
    );
    const controller = new AbortController();

    const request = {
      model: "configured-stepfun-model",
      system: "dynamic mode prompt",
      input: '{"mode":"work_state_or_rest_decision"}',
      outputSchema: buildDynamicRestDecisionOutputJsonSchema()
    };
    const output = await client.complete(
      request,
      { signal: controller.signal }
    );

    expect(output).toContain('"shouldOfferRest":false');
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://api.stepfun.example/v1/chat/completions"
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.signal).toBe(controller.signal);
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer step-secret-for-test",
      "Content-Type": "application/json"
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
      stream: boolean;
    };
    expect(body).toEqual({
      model: "configured-stepfun-model",
      messages: [
        {
          role: "system",
          content: [
            "dynamic mode prompt",
            "",
            "Output JSON Schema:",
            JSON.stringify(request.outputSchema),
            "",
            "Return one JSON object matching this schema exactly.",
            "Use the exact camelCase property names shown in the schema.",
            "Do not return Markdown or explanatory text."
          ].join("\n")
        },
        {
          role: "user",
          content: '{"mode":"work_state_or_rest_decision"}'
        }
      ],
      response_format: { type: "json_object" },
      stream: false
    });
    expect(body.messages[0]?.content).toContain('"shouldOfferRest"');
    expect(body.messages[0]?.content).toContain('"reasonCode"');
    expect(body.messages[0]?.content).toContain('"generatedTask"');
    expect(body.messages[0]?.content).toContain('"title"');
    expect(body.messages[0]?.content).toContain('"durationSeconds"');
    expect(body.messages[0]?.content).toContain('"steps"');
    expect(body.messages[0]?.content).toContain('"const":true');
    expect(body.messages[0]?.content).toContain('"then"');
    expect(body.messages[0]?.content).toContain('"else"');
    expect(body.messages[0]?.content).toContain('"type":"null"');
    expect(body.messages[0]?.content).not.toContain('"questId"');
    expect(body.messages[1]?.content).toBe(request.input);
  });

  it("delivers the distinct Mode B schema without Mode A decision fields", async () => {
    const calls: RequestInit[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      calls.push(init ?? {});
      return chatCompletion(
        '{"message":"休息一下。","generatedTask":{"title":"桌边重置","durationSeconds":60,"steps":["看远处"]}}'
      );
    };
    const request = {
      model: "configured-stepfun-model",
      system: "manual mode prompt",
      input: '{"mode":"manual_rest_quest"}',
      outputSchema: buildDynamicManualRestOutputJsonSchema()
    };

    await new StepFunRestDecisionClient(
      "test-secret",
      "https://api.stepfun.example/v1",
      fetcher
    ).complete(request);

    const body = JSON.parse(String(calls[0]?.body)) as {
      messages: Array<{ content: string }>;
    };
    const systemMessage = body.messages[0]?.content ?? "";
    expect(systemMessage).toContain(
      JSON.stringify(request.outputSchema)
    );
    expect(systemMessage).toContain('"message"');
    expect(systemMessage).toContain('"generatedTask"');
    expect(systemMessage).toContain('"title"');
    expect(systemMessage).toContain('"durationSeconds"');
    expect(systemMessage).toContain('"steps"');
    expect(systemMessage).toContain("exact camelCase property names");
    expect(systemMessage).not.toContain('"shouldOfferRest"');
    expect(systemMessage).not.toContain('"questId"');
    expect(body.messages[1]?.content).toBe(request.input);
  });

  it("normalizes a Base URL with or without a trailing slash", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      urls.push(String(input));
      return chatCompletion("{}");
    };

    await new StepFunRestDecisionClient(
      "test-secret",
      "https://api.stepfun.example/v1",
      fetcher
    ).complete(modelRequest());
    await new StepFunRestDecisionClient(
      "test-secret",
      "https://api.stepfun.example/v1/",
      fetcher
    ).complete(modelRequest());

    expect(urls).toEqual([
      "https://api.stepfun.example/v1/chat/completions",
      "https://api.stepfun.example/v1/chat/completions"
    ]);
    expect(urls.join(" ")).not.toContain("/v1/v1/");
  });

  it.each([
    ["choices", {}],
    ["message", { choices: [{}] }],
    [
      "string content",
      { choices: [{ message: { content: { json: "{}" } } }] }
    ]
  ])("rejects a response missing %s", async (_name, payload) => {
    const client = clientReturning(payload);

    await expect(client.complete(modelRequest())).rejects.toBeInstanceOf(
      SyntaxError
    );
  });

  it.each([400, 401, 429, 500, 503])(
    "preserves sanitized HTTP %s classification data without exposing the schema",
    async (status) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const consoleLog = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      const client = new StepFunRestDecisionClient(
        "test-secret",
        "https://api.stepfun.example/v1",
        async () =>
          new Response("upstream body must not be exposed", { status })
      );
      const request = {
        ...modelRequest(),
        outputSchema: {
          type: "object",
          privateSchemaMarker: "must-never-leak"
        }
      };

      const error = await client
        .complete(request)
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        message: "StepFun request failed.",
        status
      });
      expect(String(error)).not.toContain("outputSchema");
      expect(String(error)).not.toContain('"properties"');
      expect(String(error)).not.toContain("must-never-leak");
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();
    }
  );

  it("passes an external AbortSignal to fetch", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null | undefined;
    const client = new StepFunRestDecisionClient(
      "test-secret",
      "https://api.stepfun.example/v1",
      async (_input, init) => {
        receivedSignal = init?.signal;
        throw Object.assign(new Error("aborted"), {
          name: "AbortError"
        });
      }
    );
    controller.abort();

    await expect(
      client.complete(modelRequest(), { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(receivedSignal).toBe(controller.signal);
  });
});

function modelRequest() {
  return {
    model: "configured-stepfun-model",
    system: "selected system prompt",
    input: '{"mode":"test"}',
    outputSchema: { type: "object" }
  };
}

function clientReturning(payload: unknown): StepFunRestDecisionClient {
  return new StepFunRestDecisionClient(
    "test-secret",
    "https://api.stepfun.example/v1",
    async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  );
}

function chatCompletion(content: string): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl_test",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop"
        }
      ]
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}
