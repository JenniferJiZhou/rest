import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, "../../..");
const openApiPath = resolve(repositoryRoot, "contracts/openapi.yaml");

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

  it("declares the seven Unified Inbox operations with shared protocol responses", () => {
    const document = parse(
      readFileSync(openApiPath, "utf8")
    ) as OpenApiDocument;
    const operations = [
      ["/v1/inbox/items", "get", "listUnifiedInboxItems"],
      ["/v1/inbox/items/{itemId}", "get", "getUnifiedInboxItem"],
      [
        "/v1/inbox/items/{itemId}:acknowledge",
        "post",
        "acknowledgeUnifiedInboxItem"
      ],
      ["/v1/inbox/drafts/{draftId}", "get", "getUnifiedInboxDraft"],
      ["/v1/inbox/drafts/{draftId}", "patch", "updateUnifiedInboxDraft"],
      [
        "/v1/inbox/drafts/{draftId}/confirmation",
        "post",
        "createUnifiedInboxConfirmation"
      ],
      [
        "/v1/inbox/drafts/{draftId}:send",
        "post",
        "sendUnifiedInboxDraft"
      ]
    ] as const;

    for (const [path, method, operationId] of operations) {
      const operation = document.paths[path]?.[method];
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.responses["400"]).toEqual({
        $ref: "#/components/responses/Error"
      });
      expect(operation?.responses["404"]).toEqual({
        $ref: "#/components/responses/Error"
      });
      expect(operation?.responses["409"]).toEqual({
        $ref: "#/components/responses/Error"
      });
      expect(operation?.responses["503"]).toEqual({
        $ref: "#/components/responses/Error"
      });
    }
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
        parameters?: Array<{ $ref?: string }>;
        responses: Record<string, OpenApiResponse>;
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
