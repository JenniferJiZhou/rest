import { describe, expect, it } from "vitest";
import { safeTokenEqual } from "../../src/api/create-server.js";

describe("Demo token comparison", () => {
  const expected = "demo-secret-value";

  it.each([
    ["correct", expected, true],
    ["same-length wrong", "demo-secret-valuE", false],
    ["different-length wrong", "wrong", false],
    ["empty", "", false],
    ["missing", undefined, false],
    ["very long", "x".repeat(100_000), false]
  ])("compares %s input through fixed-length digests", (_case, value, result) => {
    expect(() => safeTokenEqual(value, expected)).not.toThrow();
    expect(safeTokenEqual(value, expected)).toBe(result);
  });
});
