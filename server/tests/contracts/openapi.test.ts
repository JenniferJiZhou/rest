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
});

interface OpenApiResponse {
  $ref?: string;
  headers?: Record<string, unknown>;
}

interface OpenApiDocument {
  paths: Record<
    string,
    Record<string, { responses: Record<string, OpenApiResponse> }>
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
