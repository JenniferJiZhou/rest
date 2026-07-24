import { describe, expect, it } from "vitest";
import { canonicalRequestHash } from "../../src/domain/request-hash.js";

describe("canonicalRequestHash", () => {
  it("is independent of object key order", () => {
    expect(
      canonicalRequestHash({
        source: "ios_app",
        nested: { second: 2, first: 1 }
      })
    ).toBe(
      canonicalRequestHash({
        nested: { first: 1, second: 2 },
        source: "ios_app"
      })
    );
  });

  it("changes when a business field changes", () => {
    expect(
      canonicalRequestHash({ include_gmail: true, source: "ios_app" })
    ).not.toBe(
      canonicalRequestHash({ include_gmail: false, source: "ios_app" })
    );
  });

  it("ignores request IDs, correlation IDs, and timestamps", () => {
    expect(
      canonicalRequestHash({
        request_id: "req_a",
        correlation_id: "correlation_a",
        recorded_at: "2026-07-24T15:24:00+08:00",
        session_id: "session_1",
        helpfulness: "helped"
      })
    ).toBe(
      canonicalRequestHash({
        request_id: "req_b",
        correlation_id: "correlation_b",
        recorded_at: "2026-07-24T15:25:00+08:00",
        session_id: "session_1",
        helpfulness: "helped"
      })
    );
  });

  it("preserves array order because open-loop order is semantic", () => {
    expect(
      canonicalRequestHash({
        open_loops: [
          { id: "first", text: "回复李老师" },
          { id: "second", text: "准备材料" }
        ]
      })
    ).not.toBe(
      canonicalRequestHash({
        open_loops: [
          { id: "second", text: "准备材料" },
          { id: "first", text: "回复李老师" }
        ]
      })
    );
  });
});
