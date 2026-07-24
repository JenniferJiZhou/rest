import { describe, expect, it } from "vitest";
import { InMemoryConfirmationTokenStore } from "../../src/inbox/confirmation.js";

describe("Inbox confirmation tokens", () => {
  it("binds a one-time token to the draft and version", async () => {
    const store = new InMemoryConfirmationTokenStore();
    const issued = await store.issue("draft-1", 3);

    expect(issued.token.length).toBeGreaterThanOrEqual(32);
    await expect(store.consume(issued.token, "draft-1", 2)).resolves.toBe(
      false
    );
    await expect(store.consume(issued.token, "draft-1", 3)).resolves.toBe(
      false
    );
  });

  it("consumes a valid token only once", async () => {
    const store = new InMemoryConfirmationTokenStore();
    const issued = await store.issue("draft-1", 3);

    await expect(store.consume(issued.token, "draft-1", 3)).resolves.toBe(
      true
    );
    await expect(store.consume(issued.token, "draft-1", 3)).resolves.toBe(
      false
    );
  });

  it("expires after five minutes", async () => {
    let now = Date.parse("2026-07-24T01:00:00.000Z");
    const store = new InMemoryConfirmationTokenStore(
      () => new Date(now)
    );
    const issued = await store.issue("draft-1", 3);

    expect(issued.expiresAt).toBe("2026-07-24T01:05:00.000Z");
    now += 5 * 60 * 1_000 + 1;
    await expect(store.consume(issued.token, "draft-1", 3)).resolves.toBe(
      false
    );
  });
});
