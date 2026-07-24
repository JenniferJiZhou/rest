import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../src/api/create-server.js";
import { InboxService } from "../../src/application/inbox/inbox-service.js";
import { buildServerDependencies } from "../../src/composition.js";
import { loadConfig } from "../../src/config.js";
import type {
  InboxProvider,
  InboxSendResult
} from "../../src/domain/contracts.js";
import type { InboxSender } from "../../src/inbox/ports.js";
import { InMemoryIdempotencyStore } from "../../src/infra/in-memory.js";
import { InMemoryConfirmationTokenStore } from "../../src/inbox/confirmation.js";
import {
  InMemoryCheckpointStore,
  InMemoryInboxDraftRepository,
  InMemoryInboxRepository
} from "../../src/inbox/in-memory.js";
import { FixtureInboxIntelligenceProvider } from "../../src/inbox/intelligence.js";

const DEMO_TOKEN = "inbox-demo-secret";
const APP_TOKEN = "app-token-000000000000000000000000";
const CONNECTOR_TOKEN = "connector-token-000000000000000000";
const APP_SESSION = "app-session-000000000000000000000";

describe("Unified Inbox HTTP API", () => {
  let server: FastifyInstance;
  let sender: FixtureSender;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      HUSH_DEMO_MODE: "true",
      HUSH_DEMO_TOKEN: DEMO_TOKEN,
      HUSH_APP_TOKEN: APP_TOKEN,
      HUSH_CONNECTOR_TOKEN: CONNECTOR_TOKEN,
      LOG_LEVEL: "silent"
    });
    sender = new FixtureSender();
    const dependencies = {
      ...buildServerDependencies(config),
      inboxOrigin: "mock" as const,
      demoInboxOrigin: "mock" as const,
      inbox: inboxService(new Map()),
      demoInbox: inboxService(new Map([[sender.provider, sender]]))
    };
    server = createServer(dependencies);
    await server.ready();
  }, 60_000);

  afterAll(async () => {
    await server.close();
  });

  it("ingests, summarizes, edits, confirms, and sends a draft", async () => {
    const ingest = await server.inject({
      method: "POST",
      url: "/v1/inbox/events:batch",
      headers: baseHeaders("req_inbox_ingest"),
      payload: eventBatch("req_inbox_ingest")
    });
    expect(ingest.statusCode).toBe(202);

    const itemId = ingest.json().item_ids[0] as string;
    const item = await server.inject({
      method: "GET",
      url: `/v1/inbox/items/${itemId}`,
      headers: baseHeaders("req_inbox_get")
    });
    expect(item.statusCode).toBe(200);
    expect(item.json().summary).toBeTruthy();
    const draftId = item.json().draft_id as string;
    const draft = await server.inject({
      method: "GET",
      url: `/v1/inbox/drafts/${draftId}`,
      headers: baseHeaders("req_inbox_draft")
    });

    const edited = await server.inject({
      method: "PATCH",
      url: `/v1/inbox/drafts/${draftId}`,
      headers: baseHeaders("req_inbox_edit"),
      payload: draftPatch(
        "req_inbox_edit",
        draft.json().version as number
      )
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      content: "用户确认后的最终回复",
      origin: "user",
      status: "edited"
    });

    const confirmation = await server.inject({
      method: "POST",
      url: `/v1/inbox/drafts/${draftId}/confirmation`,
      headers: baseHeaders("req_inbox_confirm")
    });
    expect(confirmation.statusCode).toBe(200);
    const sent = await server.inject({
      method: "POST",
      url: `/v1/inbox/drafts/${draftId}:send`,
      headers: {
        ...baseHeaders("req_inbox_send"),
        "idempotency-key": "inbox-send-key-0001"
      },
      payload: sendPayload(
        "req_inbox_send",
        edited.json().version as number,
        confirmation.json().confirmation_token as string
      )
    });

    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().status).toBe("sent");
    expect(sender.sentContent).toEqual(["用户确认后的最终回复"]);
  });

  it("rejects stale edits, missing resources, and reused confirmation", async () => {
    const itemId = await ingestOne("req_inbox_errors");
    const item = await server.inject({
      method: "GET",
      url: `/v1/inbox/items/${itemId}`,
      headers: baseHeaders("req_inbox_errors_get")
    });
    const draftId = item.json().draft_id as string;
    const draft = await server.inject({
      method: "GET",
      url: `/v1/inbox/drafts/${draftId}`,
      headers: baseHeaders("req_inbox_errors_draft")
    });
    const stale = await server.inject({
      method: "PATCH",
      url: `/v1/inbox/drafts/${draftId}`,
      headers: baseHeaders("req_inbox_errors_edit"),
      payload: draftPatch(
        "req_inbox_errors_edit",
        (draft.json().version as number) + 1
      )
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("INBOX_VERSION_CONFLICT");

    const missing = await server.inject({
      method: "GET",
      url: "/v1/inbox/drafts/missing",
      headers: baseHeaders("req_inbox_missing")
    });
    expect(missing.statusCode).toBe(404);

    const confirmation = await server.inject({
      method: "POST",
      url: `/v1/inbox/drafts/${draftId}/confirmation`,
      headers: baseHeaders("req_inbox_errors_confirm")
    });
    const token = confirmation.json().confirmation_token as string;
    const send = (key: string, requestId: string) =>
      server.inject({
        method: "POST",
        url: `/v1/inbox/drafts/${draftId}:send`,
        headers: {
          ...baseHeaders(requestId),
          "idempotency-key": key
        },
        payload: sendPayload(
          requestId,
          draft.json().version as number,
          token
        )
      });
    const firstSend = await send(
      "inbox-send-key-errors-1",
      "req_send_1"
    );
    expect(firstSend.statusCode, firstSend.body).toBe(200);
    const reused = await send(
      "inbox-send-key-errors-2",
      "req_send_2"
    );
    expect(reused.statusCode).toBe(403);
    expect(reused.json().error.code).toBe(
      "INBOX_CONFIRMATION_REQUIRED"
    );
  });

  it("separates app and connector authentication scopes", async () => {
    const unauthenticated = await server.inject({
      method: "GET",
      url: "/v1/inbox/items",
      headers: contractHeaders("req_inbox_unauthenticated")
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().error.code).toBe(
      "INBOX_AUTH_REQUIRED"
    );

    const connectorReadingAppData = await server.inject({
      method: "GET",
      url: "/v1/inbox/items",
      headers: {
        ...contractHeaders("req_connector_read"),
        authorization: `Bearer ${CONNECTOR_TOKEN}`
      }
    });
    expect(connectorReadingAppData.statusCode).toBe(401);

    const missingAppSession = await server.inject({
      method: "GET",
      url: "/v1/inbox/items",
      headers: {
        ...contractHeaders("req_missing_app_session"),
        authorization: `Bearer ${APP_TOKEN}`
      }
    });
    expect(missingAppSession.statusCode).toBe(401);

    const appIngestingEvents = await server.inject({
      method: "POST",
      url: "/v1/inbox/events:batch",
      headers: {
        ...contractHeaders("req_app_ingest"),
        authorization: `Bearer ${APP_TOKEN}`
      },
      payload: eventBatch("req_app_ingest", "message-app-ingest")
    });
    expect(appIngestingEvents.statusCode).toBe(401);

    const itemId = await ingestOne("req_session_bound_ingest");
    const item = await server.inject({
      method: "GET",
      url: `/v1/inbox/items/${itemId}`,
      headers: baseHeaders("req_session_bound_item")
    });
    const draftId = item.json().draft_id as string;
    const draft = await server.inject({
      method: "GET",
      url: `/v1/inbox/drafts/${draftId}`,
      headers: baseHeaders("req_session_bound_draft")
    });
    const confirmation = await server.inject({
      method: "POST",
      url: `/v1/inbox/drafts/${draftId}/confirmation`,
      headers: baseHeaders("req_session_bound_confirm")
    });
    const wrongSessionSend = await server.inject({
      method: "POST",
      url: `/v1/inbox/drafts/${draftId}:send`,
      headers: {
        ...baseHeaders("req_session_bound_send"),
        "x-hush-app-session":
          "different-session-0000000000000000000",
        "idempotency-key": "session-bound-send-key"
      },
      payload: sendPayload(
        "req_session_bound_send",
        draft.json().version as number,
        confirmation.json().confirmation_token as string
      )
    });
    expect(wrongSessionSend.statusCode).toBe(403);
    expect(wrongSessionSend.json().error.code).toBe(
      "INBOX_CONFIRMATION_REQUIRED"
    );
  });

  async function ingestOne(requestId: string): Promise<string> {
    const response = await server.inject({
      method: "POST",
      url: "/v1/inbox/events:batch",
      headers: baseHeaders(requestId),
      payload: eventBatch(requestId, `message-${requestId}`)
    });
    expect(response.statusCode).toBe(202);
    return response.json().item_ids[0] as string;
  }
});

class FixtureSender implements InboxSender {
  readonly provider: InboxProvider = "outlook";
  readonly dataOrigin = "mock" as const;
  readonly sentContent: string[] = [];

  async health(): Promise<"ready"> {
    return "ready";
  }

  async send(input: Parameters<InboxSender["send"]>[0]) {
    this.sentContent.push(input.content);
    const result: InboxSendResult = {
      draft_id: input.draftId,
      provider: this.provider,
      status: "sent",
      provider_message_id: "provider-sent-1",
      sent_at: "2026-07-24T02:00:00.000Z"
    };
    return result;
  }
}

function inboxService(
  senders: ReadonlyMap<InboxProvider, InboxSender>
): InboxService {
  const now = () => new Date("2026-07-24T01:00:00.000Z");
  let id = 0;
  return new InboxService(
    new InMemoryInboxRepository(),
    new InMemoryInboxDraftRepository(),
    new FixtureInboxIntelligenceProvider(),
    senders,
    new InMemoryConfirmationTokenStore(now),
    new InMemoryIdempotencyStore<InboxSendResult>(),
    new InMemoryCheckpointStore(now),
    { now },
    { next: (prefix) => `${prefix}-${++id}` }
  );
}

function baseHeaders(requestId: string) {
  return {
    ...contractHeaders(requestId),
    "x-hush-demo-token": DEMO_TOKEN,
    "x-hush-app-session": APP_SESSION
  };
}

function contractHeaders(requestId: string) {
  return {
    "x-request-id": requestId,
    "x-client-version": "0.1.0-test",
    "x-contract-version": "1.0"
  };
}

function eventBatch(
  requestId: string,
  providerMessageId = "message-http-1"
) {
  return {
    schema_version: "1.0",
    request_id: requestId,
    checkpoint: `checkpoint-${providerMessageId}`,
    events: [
      {
        provider: "outlook",
        account_id: "hush@example.com",
        conversation_id: "conversation-http-1",
        conversation_type: "direct",
        conversation_name: "演示会话",
        provider_message_id: providerMessageId,
        sender: "sender@example.com",
        sender_ref: null,
        recipients: ["hush@example.com"],
        subject: "演示确认",
        content: "请确认演示时间并回复。",
        received_at: "2026-07-24T09:00:00+08:00",
        coverage: {
          source: "official_api",
          complete: true,
          note: null
        }
      }
    ]
  };
}

function draftPatch(requestId: string, expectedVersion: number) {
  return {
    schema_version: "1.0",
    request_id: requestId,
    content: "用户确认后的最终回复",
    content_type: "text",
    expected_version: expectedVersion
  };
}

function sendPayload(
  requestId: string,
  expectedVersion: number,
  confirmationToken: string
) {
  return {
    schema_version: "1.0",
    request_id: requestId,
    expected_version: expectedVersion,
    confirmation_token: confirmationToken
  };
}
