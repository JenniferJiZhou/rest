import { describe, expect, it } from "vitest";
import {
  CannedUnifiedInboxProvider,
  UnavailableUnifiedInboxProvider
} from "../../src/infra/unified-inbox-providers.js";

describe("UnifiedInboxProvider contract", () => {
  it("labels the canned snapshot and simulated delivery as mock", async () => {
    const provider = new CannedUnifiedInboxProvider();
    const snapshot = await provider.loadSnapshot();
    const item = snapshot.items[0]!;
    const draft = snapshot.drafts.find(
      (candidate) => candidate.itemId === item.id
    )!;
    const confirmation = {
      confirmationId: "confirmation_contract",
      draftId: draft.id,
      itemId: item.id,
      source: item.source,
      draftVersion: draft.version,
      expiresAt: "2026-07-24T12:00:00.000Z"
    };

    expect(provider.dataOrigin).toBe("mock");
    await expect(provider.health()).resolves.toBe("ready");
    expect(new Set(snapshot.items.map((value) => value.source))).toEqual(
      new Set(["feishu", "dingtalk", "outlook", "qq_mail"])
    );
    await expect(
      provider.deliver({ item, draft, confirmation })
    ).resolves.toEqual({ deliveryMode: "simulated" });
  });

  it("fails explicitly when the unavailable Provider is selected", async () => {
    const provider = new UnavailableUnifiedInboxProvider();

    expect(provider.dataOrigin).toBe("mock");
    await expect(provider.health()).resolves.toBe("unavailable");
    await expect(provider.loadSnapshot()).rejects.toMatchObject({
      statusCode: 503,
      retryable: true,
      details: { reason: "UNIFIED_INBOX_PROVIDER_UNAVAILABLE" }
    });
  });
});
