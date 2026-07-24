import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../src/api/create-server.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";

const servers: FastifyInstance[] = [];

describe("Unified Inbox TCP vertical slice", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("runs the canned edit-confirm-send flow over a real loopback listener", async () => {
    const server = createServer(
      buildServerDependencies(
        loadConfig({
          NODE_ENV: "test",
          HUSH_UNIFIED_INBOX_PROVIDER: "canned",
          LOG_LEVEL: "silent"
        })
      )
    );
    await server.listen({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    const address = server.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unified Inbox test server did not expose a TCP port");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const list = await fetch(`${baseUrl}/v1/inbox/items`, {
      headers: protocolHeaders("req_vertical_inbox_list")
    });
    expect(list.status).toBe(200);
    expect(list.headers.get("x-hush-data-origin")).toBe("mock");
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(4);

    const update = await fetch(
      `${baseUrl}/v1/inbox/drafts/draft_feishu_001`,
      {
        method: "PATCH",
        headers: mutationHeaders(
          "req_vertical_inbox_update",
          "idem-vertical-inbox-update"
        ),
        body: JSON.stringify({
          schema_version: "1.0",
          request_id: "req_vertical_inbox_update",
          operation: "update_body",
          expected_version: 1,
          body: "Synthetic TCP vertical-slice reply."
        })
      }
    );
    expect(update.status).toBe(200);

    const confirmationResponse = await fetch(
      `${baseUrl}/v1/inbox/drafts/draft_feishu_001/confirmation`,
      {
        method: "POST",
        headers: mutationHeaders(
          "req_vertical_inbox_confirmation",
          "idem-vertical-inbox-confirmation"
        ),
        body: JSON.stringify({
          schema_version: "1.0",
          request_id: "req_vertical_inbox_confirmation",
          expected_version: 2
        })
      }
    );
    expect(confirmationResponse.status).toBe(201);
    const confirmation = (await confirmationResponse.json()) as {
      confirmation: { confirmation_id: string };
    };

    const send = await fetch(
      `${baseUrl}/v1/inbox/drafts/draft_feishu_001:send`,
      {
        method: "POST",
        headers: mutationHeaders(
          "req_vertical_inbox_send",
          "idem-vertical-inbox-send"
        ),
        body: JSON.stringify({
          schema_version: "1.0",
          request_id: "req_vertical_inbox_send",
          confirmation_id: confirmation.confirmation.confirmation_id,
          expected_version: 2
        })
      }
    );
    const result = (await send.json()) as {
      result: { delivery_mode: string; status: string };
    };
    expect(send.status).toBe(200);
    expect(send.headers.get("x-hush-data-origin")).toBe("mock");
    expect(result.result).toMatchObject({
      status: "sent",
      delivery_mode: "simulated"
    });
  });
});

function protocolHeaders(requestId: string): Record<string, string> {
  return {
    "x-request-id": requestId,
    "x-client-version": "1.0.0-test",
    "x-contract-version": "1.0"
  };
}

function mutationHeaders(
  requestId: string,
  idempotencyKey: string
): Record<string, string> {
  return {
    ...protocolHeaders(requestId),
    "content-type": "application/json",
    "idempotency-key": idempotencyKey
  };
}
