import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../src/api/create-server.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";

const DEMO_TOKEN = "unified-inbox-demo";

describe("Unified Inbox fixture vertical slice", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const dependencies = buildServerDependencies(
      loadConfig({
        NODE_ENV: "test",
        HUSH_DEMO_MODE: "true",
        HUSH_DEMO_TOKEN: DEMO_TOKEN,
        LOG_LEVEL: "silent"
      })
    );
    server = createServer(dependencies);
    await server.ready();
  }, 60_000);

  afterAll(async () => {
    await server.close();
  });

  it("preserves a user edit and sends only after confirmation", async () => {
    const ingest = await server.inject({
      method: "POST",
      url: "/v1/inbox/events:batch",
      headers: headers("vertical-ingest"),
      payload: {
        schema_version: "1.0",
        request_id: "vertical-ingest",
        checkpoint: "vertical-checkpoint",
        events: [
          {
            provider: "feishu",
            account_id: "fixture-feishu",
            conversation_id: "fixture-chat",
            provider_message_id: "fixture-message",
            sender: "fixture-colleague",
            recipients: ["fixture-feishu"],
            subject: null,
            content: "请确认明天的演示时间。",
            received_at: "2026-07-24T09:00:00+08:00",
            coverage: {
              source: "official_api",
              complete: true,
              note: null
            }
          }
        ]
      }
    });
    const itemId = ingest.json().item_ids[0] as string;
    const item = await server.inject({
      method: "GET",
      url: `/v1/inbox/items/${itemId}`,
      headers: headers("vertical-item")
    });
    const draftId = item.json().draft_id as string;
    const draft = await server.inject({
      method: "GET",
      url: `/v1/inbox/drafts/${draftId}`,
      headers: headers("vertical-draft")
    });
    const edit = await server.inject({
      method: "PATCH",
      url: `/v1/inbox/drafts/${draftId}`,
      headers: headers("vertical-edit"),
      payload: {
        schema_version: "1.0",
        request_id: "vertical-edit",
        content: "用户最终确认文本",
        content_type: "text",
        expected_version: draft.json().version
      }
    });
    const confirmation = await server.inject({
      method: "POST",
      url: `/v1/inbox/drafts/${draftId}/confirmation`,
      headers: headers("vertical-confirm")
    });
    const sent = await server.inject({
      method: "POST",
      url: `/v1/inbox/drafts/${draftId}:send`,
      headers: {
        ...headers("vertical-send"),
        "idempotency-key": "vertical-send-key"
      },
      payload: {
        schema_version: "1.0",
        request_id: "vertical-send",
        expected_version: edit.json().version,
        confirmation_token: confirmation.json().confirmation_token
      }
    });

    expect(ingest.statusCode).toBe(202);
    expect(item.json().summary).toBeTruthy();
    expect(edit.json().content).toBe("用户最终确认文本");
    expect(sent.statusCode).toBe(200);
    expect(sent.json().status).toBe("sent");
  });
});

function headers(requestId: string) {
  return {
    "x-request-id": requestId,
    "x-client-version": "0.1.0-test",
    "x-contract-version": "1.0",
    "x-hush-demo-token": DEMO_TOKEN
  };
}
