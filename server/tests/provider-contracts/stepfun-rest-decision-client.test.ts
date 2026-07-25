import { describe, expect, it } from "vitest";
import { StepFunRestDecisionClient } from "../../src/agent/rest-decision/stepfun-rest-decision-client.js";

describe("StepFunRestDecisionClient", () => {
  it("uses the non-streaming Responses API with strict structured output", async () => {
    const calls: Array<{
      input: string | URL | Request;
      init?: RequestInit;
    }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({
        input,
        ...(init === undefined ? {} : { init })
      });
      return new Response(
        JSON.stringify({
          id: "resp_stepfun_test",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: '{"shouldOfferRest":false,"reasonCode":"insufficient_signal","message":"先照着现在的节奏继续。","generatedTask":null}'
                }
              ]
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    };
    const client = new StepFunRestDecisionClient(
      "step-secret-for-test",
      "https://api.stepfun.example/v1/",
      fetcher
    );
    const controller = new AbortController();
    const schema = {
      type: "object",
      additionalProperties: false
    };

    const output = await client.complete(
      {
        model: "step-3.7-flash",
        system: "dynamic mode prompt",
        input: '{"mode":"work_state_or_rest_decision"}',
        outputSchema: schema
      },
      { signal: controller.signal }
    );

    expect(output).toContain('"shouldOfferRest":false');
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://api.stepfun.example/v1/responses"
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.signal).toBe(controller.signal);
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer step-secret-for-test",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "step-3.7-flash",
      instructions: "dynamic mode prompt",
      input: '{"mode":"work_state_or_rest_decision"}',
      stream: false,
      text: {
        format: {
          type: "json_schema",
          name: "dynamic_rest_decision",
          strict: true,
          schema
        }
      }
    });
  });
});
