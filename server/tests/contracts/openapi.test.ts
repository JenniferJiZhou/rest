import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, "../../..");
const openApiPath = resolve(repositoryRoot, "contracts/openapi.yaml");
const restRecommendationSchemaPath = resolve(
  repositoryRoot,
  "contracts/schemas/rest-recommendation.schema.json"
);

describe("OpenAPI contract", () => {
  it("parses and points only to existing local schema files", () => {
    const document = parse(readFileSync(openApiPath, "utf8")) as unknown;
    const references = collectReferences(document).filter(
      (reference) => !reference.startsWith("#")
    );

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      const [relativePath] = reference.split("#");
      expect(relativePath).toBeTruthy();
      expect(() =>
        readFileSync(resolve(dirname(openApiPath), relativePath!), "utf8")
      ).not.toThrow();
    }
  });

  it("declares Contract headers and version mismatch responses for W1 APIs", () => {
    const document = parse(
      readFileSync(openApiPath, "utf8")
    ) as OpenApiDocument;
    const operations = [
      ["/v1/rest/evaluate", "post"],
      ["/v1/rest/check-in", "post"],
      ["/v1/rest/recommend", "post"],
      ["/v1/rest/feedback", "post"],
      ["/v1/handoff/start", "post"],
      ["/v1/handoff/{jobId}", "get"],
      ["/v1/handoff/{jobId}/cancel", "post"]
    ] as const;

    for (const [path, method] of operations) {
      const responses = document.paths[path]![method]!.responses;
      const expectedError =
        path === "/v1/rest/evaluate" ||
        path === "/v1/rest/recommend"
          ? "#/components/responses/RestContractError"
          : "#/components/responses/Error";
      expect(responses["409"]).toEqual({
        $ref: expectedError
      });
      for (const response of Object.values(responses)) {
        const definition =
          "$ref" in response
            ? document.components.responses[
                response.$ref!.split("/").at(-1)!
              ]!
            : response;
        expect(definition.headers).toMatchObject({
          "X-Request-ID": expect.any(Object),
          "X-Contract-Version": expect.any(Object),
          "X-Hush-Data-Origin": expect.any(Object)
        });
      }
    }
  });

  it("declares the Unified Inbox API surface", () => {
    const document = parse(
      readFileSync(openApiPath, "utf8")
    ) as OpenApiDocument;
    const operations = [
      ["/v1/inbox/events:batch", "post"],
      ["/v1/inbox/items", "get"],
      ["/v1/inbox/items/{itemId}", "get"],
      ["/v1/inbox/items/{itemId}:acknowledge", "post"],
      ["/v1/inbox/items/{itemId}/summary", "post"],
      ["/v1/inbox/items/{itemId}/draft", "post"],
      ["/v1/inbox/drafts/{draftId}", "get"],
      ["/v1/inbox/drafts/{draftId}", "patch"],
      ["/v1/inbox/drafts/{draftId}/confirmation", "post"],
      ["/v1/inbox/drafts/{draftId}:send", "post"],
      ["/v1/inbox/sync-status", "get"]
    ] as const;

    for (const [path, method] of operations) {
      expect(document.paths[path]?.[method]).toBeDefined();
    }

    expect(
      document.paths["/v1/inbox/items/{itemId}:acknowledge"]!.post!
        .requestBody!.content["application/json"]!.schema
    ).toEqual({ $ref: "./schemas/inbox-acknowledge.schema.json" });
  });

  it("declares Provider unavailable for dynamic Rest operations", () => {
    const document = parse(
      readFileSync(openApiPath, "utf8")
    ) as OpenApiDocument;

    expect(
      document.paths["/v1/rest/evaluate"]!.post!.responses["503"]
    ).toEqual({
      $ref: "#/components/responses/RestContractError"
    });
    expect(
      document.paths["/v1/rest/recommend"]!.post!.responses["503"]
    ).toEqual({
      $ref: "#/components/responses/RestContractError"
    });
  });

  it("negotiates Contract 1.0 and 1.1 for evaluate and recommend", () => {
    const document = parse(
      readFileSync(openApiPath, "utf8")
    ) as OpenApiDocument;
    for (const path of [
      "/v1/rest/evaluate",
      "/v1/rest/recommend"
    ]) {
      const operation = document.paths[path]!.post!;
      const contractParameter = operation.parameters?.find(
        (parameter) =>
          "$ref" in parameter &&
          parameter.$ref ===
            "#/components/parameters/RestContractVersion"
      );
      expect(contractParameter).toBeDefined();
    }
    expect(
      document.components.parameters.RestContractVersion!
        .schema.enum
    ).toEqual(["1.0", "1.1"]);
    expect(
      document.components.parameters.ContractVersion!.schema.const
    ).toBe("1.0");
  });

  it("documents the optional privacy-bounded settings test context", () => {
    const document = parse(
      readFileSync(openApiPath, "utf8")
    ) as OpenApiDocument;
    const operation = document.paths["/v1/rest/recommend"]!.post!;
    expect(operation.description).toContain("decision_context");
    expect(operation.description).toContain("learning_eligible=false");

    const schema = JSON.parse(
      readFileSync(restRecommendationSchemaPath, "utf8")
    ) as RestRecommendationSchemaDocument;
    const context = schema.$defs.ManualRestDecisionContext!;
    const request = schema.$defs.RestRecommendationRequestV1_1!;

    expect(request.required).not.toContain("decision_context");
    expect(request.properties.decision_context).toEqual({
      $ref: "#/$defs/ManualRestDecisionContext"
    });
    expect(context.additionalProperties).toBe(false);
    expect(context.required).toContain("learning_eligible");
    expect(context.properties.learning_eligible).toMatchObject({
      const: false
    });
    expect(context.properties.raw_app_names_included).toMatchObject({
      const: false
    });
    expect(context.properties.full_url_included).toMatchObject({
      const: false
    });
    expect(context.properties.page_title_included).toMatchObject({
      const: false
    });
    expect(context.properties.daily_app_usage_minutes.type).toEqual([
      "integer",
      "null"
    ]);
    expect(context.properties.minutes_since_last_rest.type).toEqual([
      "integer",
      "null"
    ]);
    expect(request.allOf).toHaveLength(3);
  });

});

interface OpenApiResponse {
  $ref?: string;
  headers?: Record<string, unknown>;
}

interface OpenApiDocument {
  paths: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        description?: string;
        parameters?: Array<{ $ref?: string }>;
        responses: Record<string, OpenApiResponse>;
        requestBody?: {
          content: Record<string, { schema: unknown }>;
        };
      }
    >
  >;
  components: {
    parameters: Record<
      string,
      { schema: { const?: string; enum?: string[] } }
    >;
    responses: Record<string, OpenApiResponse>;
  };
}

interface JsonSchemaObject {
  additionalProperties?: boolean;
  allOf?: unknown[];
  required?: string[];
  properties: Record<
    string,
    { $ref?: string; const?: unknown; type?: string | string[] }
  >;
}

interface RestRecommendationSchemaDocument {
  $defs: Record<string, JsonSchemaObject | undefined>;
}

function collectReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectReferences);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const object = value as Record<string, unknown>;
  return [
    ...(typeof object.$ref === "string" ? [object.$ref] : []),
    ...Object.values(object).flatMap(collectReferences)
  ];
}
