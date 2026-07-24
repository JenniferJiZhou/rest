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
      expect(responses["409"]).toEqual({
        $ref: "#/components/responses/Error"
      });
      for (const response of Object.values(responses)) {
        const definition =
          "$ref" in response
            ? document.components.responses.Error
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

  it("declares Provider unavailable for Rest evaluate", () => {
    const document = parse(
      readFileSync(openApiPath, "utf8")
    ) as OpenApiDocument;

    expect(
      document.paths["/v1/rest/evaluate"]!.post!.responses["503"]
    ).toEqual({
      $ref: "#/components/responses/Error"
    });
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
        responses: Record<string, OpenApiResponse>;
        requestBody?: {
          content: Record<string, { schema: unknown }>;
        };
      }
    >
  >;
  components: {
    responses: { Error: OpenApiResponse };
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
