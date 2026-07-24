import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "../../src/infra/in-memory.js";

describe("InMemoryIdempotencyStore", () => {
  it("shares one in-flight creation across concurrent identical claims", async () => {
    const store = new InMemoryIdempotencyStore<string>();
    const started = deferred<void>();
    const gate = deferred<void>();
    let createCalls = 0;
    const create = async () => {
      createCalls += 1;
      started.resolve();
      await gate.promise;
      return "created-value";
    };

    const claims = Array.from({ length: 20 }, () =>
      store.claimOrGet({
        key: "idem-claim-same",
        requestHash: "hash-same",
        ttlSeconds: 60,
        create
      })
    );
    await started.promise;
    expect(createCalls).toBe(1);
    gate.resolve();

    const results = await Promise.all(claims);
    expect(results.filter((result) => result.kind === "created")).toHaveLength(
      1
    );
    expect(
      results.filter(
        (result) => result.kind === "existing_same_request"
      )
    ).toHaveLength(19);
    expect(
      results.every(
        (result) =>
          result.kind !== "conflict_different_request" &&
          result.value === "created-value"
      )
    ).toBe(true);
  });

  it("reports a conflict without waiting for another request creation", async () => {
    const store = new InMemoryIdempotencyStore<string>();
    const started = deferred<void>();
    const gate = deferred<void>();
    const first = store.claimOrGet({
      key: "idem-claim-conflict",
      requestHash: "hash-a",
      ttlSeconds: 60,
      create: async () => {
        started.resolve();
        await gate.promise;
        return "value-a";
      }
    });
    await started.promise;

    const conflict = await store.claimOrGet({
      key: "idem-claim-conflict",
      requestHash: "hash-b",
      ttlSeconds: 60,
      create: async () => "value-b"
    });

    expect(conflict).toEqual({ kind: "conflict_different_request" });
    gate.resolve();
    await first;
  });

  it("clears a failed creation so a later retry can claim the key", async () => {
    const store = new InMemoryIdempotencyStore<string>();

    await expect(
      store.claimOrGet({
        key: "idem-claim-retry",
        requestHash: "hash-retry",
        ttlSeconds: 60,
        create: async () => {
          throw new Error("creation failed");
        }
      })
    ).rejects.toThrow("creation failed");

    await expect(
      store.claimOrGet({
        key: "idem-claim-retry",
        requestHash: "hash-retry",
        ttlSeconds: 60,
        create: async () => "retry-value"
      })
    ).resolves.toEqual({
      kind: "created",
      value: "retry-value"
    });
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
