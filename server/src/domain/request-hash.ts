import { createHash } from "node:crypto";

const NON_BUSINESS_FIELDS = new Set([
  "schema_version",
  "request_id",
  "correlation_id",
  "recorded_at",
  "created_at",
  "updated_at",
  "timestamp"
]);

export function canonicalRequestHash(input: unknown): string {
  return createHash("sha256")
    .update(canonicalize(input))
    .digest("hex");
}

export function canonicalize(input: unknown): string {
  if (input === null || input === undefined) {
    return "null";
  }
  if (typeof input === "string") {
    return JSON.stringify(input.normalize("NFC"));
  }
  if (typeof input === "boolean") {
    return input ? "true" : "false";
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new TypeError("canonical requests require finite numbers");
    }
    return JSON.stringify(input);
  }
  if (Array.isArray(input)) {
    return `[${input.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof input === "object") {
    const entries = Object.entries(input)
      .filter(
        ([key, value]) =>
          !NON_BUSINESS_FIELDS.has(key) && value !== undefined
      )
      .sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      );
    return `{${entries
      .map(
        ([key, value]) =>
          `${JSON.stringify(key)}:${canonicalize(value)}`
      )
      .join(",")}}`;
  }
  throw new TypeError(
    `unsupported canonical request value: ${typeof input}`
  );
}
