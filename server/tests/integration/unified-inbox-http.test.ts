import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../src/api/create-server.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";
import type { UnifiedInboxProvider } from "../../src/domain/ports.js";

const servers: FastifyInstance[] = [];

describe("Unified Inbox HTTP vertical slice", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("lists canned items through the shared protocol and security headers", async () => {
    const server = await createTestServer();
    const response = await server.inject({
      method: "GET",
      url: "/v1/inbox/items?needs_reply=true",
      headers: headers("req_http_inbox_list")
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "x-request-id": "req_http_inbox_list",
      "x-contract-version": "1.0",
      "x-hush-data-origin": "mock",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store"
    });
    expect(response.json()).toMatchObject({
      schema_version: "1.0",
      request_id: "req_http_inbox_list",
      items: [
        { source: "feishu", needs_reply: true },
        { source: "outlook", needs_reply: true },
        { source: "qq_mail", needs_reply: true }
      ],
      next_cursor: null
    });
  });

  it("runs detail, acknowledge, draft edit, confirmation, and simulated send over HTTP", async () => {
    const server = await createTestServer();

    const detail = await server.inject({
      method: "GET",
      url: "/v1/inbox/items/item_feishu_001",
      headers: headers("req_http_inbox_detail")
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      item: {
        id: "item_feishu_001",
        provider_capabilities: { can_send_reply: true }
      }
    });

    const acknowledged = await server.inject({
      method: "POST",
      url: "/v1/inbox/items/item_dingtalk_001:acknowledge",
      headers: mutationHeaders("req_http_inbox_ack", "idem-http-inbox-ack"),
      payload: {
        schema_version: "1.0",
        request_id: "req_http_inbox_ack"
      }
    });
    expect(acknowledged.statusCode).toBe(200);
    expect(acknowledged.json()).toMatchObject({
      item: { status: "acknowledged", is_unread: false }
    });

    const draft = await server.inject({
      method: "GET",
      url: "/v1/inbox/drafts/draft_feishu_001",
      headers: headers("req_http_draft_get")
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({
      draft: { id: "draft_feishu_001", version: 1 }
    });

    const updated = await server.inject({
      method: "PATCH",
      url: "/v1/inbox/drafts/draft_feishu_001",
      headers: mutationHeaders(
        "req_http_draft_update",
        "idem-http-draft-update"
      ),
      payload: {
        schema_version: "1.0",
        request_id: "req_http_draft_update",
        operation: "update_body",
        expected_version: 1,
        body: "Thanks. I reviewed the synthetic checklist."
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      draft: { version: 2, confirmation_state: "invalidated" }
    });

    const confirmation = await server.inject({
      method: "POST",
      url: "/v1/inbox/drafts/draft_feishu_001/confirmation",
      headers: mutationHeaders(
        "req_http_confirmation",
        "idem-http-confirmation"
      ),
      payload: {
        schema_version: "1.0",
        request_id: "req_http_confirmation",
        expected_version: 2
      }
    });
    expect(confirmation.statusCode).toBe(201);
    const confirmationId = confirmation.json().confirmation.confirmation_id;

    const sent = await server.inject({
      method: "POST",
      url: "/v1/inbox/drafts/draft_feishu_001:send",
      headers: mutationHeaders("req_http_send", "idem-http-send"),
      payload: {
        schema_version: "1.0",
        request_id: "req_http_send",
        confirmation_id: confirmationId,
        expected_version: 2
      }
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.headers["x-hush-data-origin"]).toBe("mock");
    expect(sent.json()).toMatchObject({
      result: {
        status: "sent",
        delivery_mode: "simulated"
      }
    });
  });

  it("keeps Normal unavailable while a valid Demo token selects an isolated mock graph", async () => {
    const server = await createTestServer({
      HUSH_UNIFIED_INBOX_PROVIDER: "unavailable",
      HUSH_DEMO_MODE: "true",
      HUSH_DEMO_TOKEN: "demo-inbox-secret"
    });

    const normal = await server.inject({
      method: "GET",
      url: "/v1/inbox/items",
      headers: headers("req_normal_unavailable")
    });
    expect(normal.statusCode).toBe(503);
    expect(normal.headers["x-hush-data-origin"]).toBe("mock");
    expect(normal.json()).toMatchObject({
      error: {
        retryable: true,
        details: { reason: "UNIFIED_INBOX_PROVIDER_UNAVAILABLE" }
      }
    });

    const demo = await server.inject({
      method: "GET",
      url: "/v1/inbox/items",
      headers: {
        ...headers("req_demo_inbox"),
        "x-hush-demo-token": "demo-inbox-secret"
      }
    });
    expect(demo.statusCode).toBe(200);
    expect(demo.headers["x-hush-data-origin"]).toBe("mock");
    expect(demo.json().items).toHaveLength(4);

    const invalidDemo = await server.inject({
      method: "GET",
      url: "/v1/inbox/items",
      headers: {
        ...headers("req_invalid_demo_inbox"),
        "x-hush-demo-token": "wrong-demo-secret"
      }
    });
    expect(invalidDemo.statusCode).toBe(403);
  });

  it("returns protocol-safe 400, 404, and 409 errors without losing security headers", async () => {
    const server = await createTestServer();
    const missing = await server.inject({
      method: "GET",
      url: "/v1/inbox/items/missing",
      headers: headers("req_http_missing")
    });
    expectError(missing, 404, "UNIFIED_INBOX_ITEM_NOT_FOUND");

    const extraField = await server.inject({
      method: "PATCH",
      url: "/v1/inbox/drafts/draft_feishu_001",
      headers: mutationHeaders(
        "req_http_extra_field",
        "idem-http-extra-field"
      ),
      payload: {
        schema_version: "1.0",
        request_id: "req_http_extra_field",
        operation: "update_body",
        expected_version: 1,
        body: "Safe body.",
        provider_secret: "must-not-be-accepted"
      }
    });
    expectError(extraField, 400);
    expect(extraField.body).not.toContain("must-not-be-accepted");

    const mismatch = await server.inject({
      method: "PATCH",
      url: "/v1/inbox/drafts/draft_feishu_001",
      headers: mutationHeaders(
        "req_http_header_id",
        "idem-http-request-mismatch"
      ),
      payload: {
        schema_version: "1.0",
        request_id: "req_http_body_id",
        operation: "discard",
        expected_version: 1
      }
    });
    expectError(mismatch, 400);

    const first = await server.inject({
      method: "PATCH",
      url: "/v1/inbox/drafts/draft_feishu_001",
      headers: mutationHeaders("req_http_reuse", "idem-http-reuse"),
      payload: {
        schema_version: "1.0",
        request_id: "req_http_reuse",
        operation: "update_body",
        expected_version: 1,
        body: "First compatible request."
      }
    });
    expect(first.statusCode).toBe(200);

    const changedReuse = await server.inject({
      method: "PATCH",
      url: "/v1/inbox/drafts/draft_feishu_001",
      headers: mutationHeaders("req_http_reuse", "idem-http-reuse-other"),
      payload: {
        schema_version: "1.0",
        request_id: "req_http_reuse",
        operation: "update_body",
        expected_version: 2,
        body: "Different content under the same request id."
      }
    });
    expectError(changedReuse, 409, "REQUEST_ID_REUSED");

    const noConfirmation = await server.inject({
      method: "POST",
      url: "/v1/inbox/drafts/draft_outlook_001:send",
      headers: mutationHeaders(
        "req_http_no_confirmation",
        "idem-http-no-confirmation"
      ),
      payload: {
        schema_version: "1.0",
        request_id: "req_http_no_confirmation",
        confirmation_id: "missing-confirmation",
        expected_version: 1
      }
    });
    expectError(
      noConfirmation,
      409,
      "UNIFIED_INBOX_CONFIRMATION_MISSING"
    );
  });

  it("keeps Demo mutations isolated from the Normal Canned repository", async () => {
    const server = await createTestServer({
      HUSH_DEMO_MODE: "true",
      HUSH_DEMO_TOKEN: "demo-inbox-secret"
    });
    const demoHeaders = {
      ...mutationHeaders(
        "req_demo_draft_update",
        "idem-demo-draft-update"
      ),
      "x-hush-demo-token": "demo-inbox-secret"
    };

    const demoUpdate = await server.inject({
      method: "PATCH",
      url: "/v1/inbox/drafts/draft_feishu_001",
      headers: demoHeaders,
      payload: {
        schema_version: "1.0",
        request_id: "req_demo_draft_update",
        operation: "update_body",
        expected_version: 1,
        body: "Only the isolated Demo graph sees this body."
      }
    });
    expect(demoUpdate.statusCode).toBe(200);
    expect(demoUpdate.json().draft.version).toBe(2);

    const normal = await server.inject({
      method: "GET",
      url: "/v1/inbox/drafts/draft_feishu_001",
      headers: headers("req_normal_after_demo")
    });
    expect(normal.statusCode).toBe(200);
    expect(normal.json().draft).toMatchObject({
      version: 1,
      body: "Thanks for the mock message. I will follow up shortly."
    });
  });

  it("keeps health independent from the Unified Inbox Provider", async () => {
    const health = vi.fn(async () => {
      throw new Error("health must not call Inbox Provider");
    });
    const provider: UnifiedInboxProvider = {
      dataOrigin: "mock",
      health,
      loadSnapshot: async () => {
        throw new Error("snapshot must not load from health");
      },
      deliver: async () => {
        throw new Error("delivery must not run from health");
      }
    };
    const server = createServer(
      buildServerDependencies(
        loadConfig({
          NODE_ENV: "test",
          LOG_LEVEL: "silent"
        }),
        { normalInboxProvider: provider }
      )
    );
    await server.ready();
    servers.push(server);

    const response = await server.inject({
      method: "GET",
      url: "/v1/health"
    });

    expect(response.statusCode).toBe(200);
    expect(health).not.toHaveBeenCalled();
  });

  it("does not log Inbox bodies, confirmations, or credentials", async () => {
    const output: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });
    const server = createServer(
      buildServerDependencies(
        loadConfig({
          NODE_ENV: "test",
          HUSH_UNIFIED_INBOX_PROVIDER: "canned",
          LOG_LEVEL: "info"
        })
      )
    );
    await server.ready();

    try {
      await server.inject({
        method: "POST",
        url: "/v1/inbox/drafts/draft_feishu_001:send",
        headers: {
          ...mutationHeaders(
            "req_log_safe_inbox",
            "idem-log-safe-inbox"
          ),
          authorization: "Bearer private-inbox-authorization",
          cookie: "session=private-inbox-cookie"
        },
        payload: {
          schema_version: "1.0",
          request_id: "req_log_safe_inbox",
          confirmation_id: "private-confirmation-marker",
          expected_version: 1,
          private_body: "private-draft-body-marker"
        }
      });
    } finally {
      await server.close();
      write.mockRestore();
    }

    const logs = output.join("");
    expect(logs).not.toContain("private-inbox-authorization");
    expect(logs).not.toContain("private-inbox-cookie");
    expect(logs).not.toContain("private-confirmation-marker");
    expect(logs).not.toContain("private-draft-body-marker");
  });
});

async function createTestServer(
  environment: NodeJS.ProcessEnv = {}
): Promise<FastifyInstance> {
  const server = createServer(
    buildServerDependencies(
      loadConfig({
        NODE_ENV: "test",
        HUSH_UNIFIED_INBOX_PROVIDER: "canned",
        LOG_LEVEL: "silent",
        ...environment
      })
    )
  );
  await server.ready();
  servers.push(server);
  return server;
}

function headers(requestId: string): Record<string, string> {
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
    ...headers(requestId),
    "idempotency-key": idempotencyKey
  };
}

function expectError(
  response: {
    statusCode: number;
    headers: Record<
      string,
      string | string[] | number | undefined
    >;
    json(): {
      error: { details?: { reason?: string } | null };
    };
    body: string;
  },
  statusCode: number,
  reason?: string
): void {
  expect(response.statusCode).toBe(statusCode);
  expect(response.headers).toMatchObject({
    "x-contract-version": "1.0",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store"
  });
  if (reason !== undefined) {
    expect(response.json().error.details?.reason).toBe(reason);
  }
}
