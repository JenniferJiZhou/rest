import { describe, expect, it } from "vitest";
import { StepFunRestDecisionClient } from "../../src/agent/rest-decision/stepfun-rest-decision-client.js";

describe("StepFunRestDecisionClient", () => {
  it("uses non-streaming Chat Completions JSON mode", async () => {
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

    const output = await client.complete(
      {
        model: "configured-stepfun-model",
        system: "dynamic mode prompt",
        input: '{"mode":"work_state_or_rest_decision"}',
        outputSchema: { type: "object" }
      },
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
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "configured-stepfun-model",
      messages: [
        {
          role: "system",
          content: "dynamic mode prompt"
        },
        {
          role: "user",
          content: '{"mode":"work_state_or_rest_decision"}'
        }
      ],
      response_format: { type: "json_object" },
      stream: false
    });
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
    "preserves sanitized HTTP %s classification data",
    async (status) => {
      const client = new StepFunRestDecisionClient(
        "test-secret",
        "https://api.stepfun.example/v1",
        async () =>
          new Response("upstream body must not be exposed", { status })
      );

      await expect(client.complete(modelRequest())).rejects.toMatchObject({
        message: "StepFun request failed.",
        status
      });
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
