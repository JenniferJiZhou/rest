import { spawn } from "node:child_process";
import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse
} from "node:http";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const serverDirectory = resolve(import.meta.dirname, "../..");
const script = resolve(serverDirectory, "scripts/smoke-inbox.mjs");
const timeout = 30_000;
const servers: Server[] = [];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("Unified Inbox external smoke harness", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it("validates complete public cards without exposing private content", async () => {
    const privateValues = [
      "private-account", "private-conversation", "private-provider-message",
      "private-summary", "private-draft", "private-name"
    ];
    const baseUrl = await startServer((request, response) => {
      if (request.url === "/v1/inbox/sync-status") return json(response, 200, [readySync("feishu")]);
      if (request.url === "/v1/inbox/items?limit=100") {
        return json(response, 200, { items: [publicCard("feishu")], next_cursor: null });
      }
      return error(response);
    });

    const result = await runSmoke(baseUrl, ["--provider", "feishu", "--mode", "read"]);

    expect(result.code, result.output).toBe(0);
    expect(result.output).toBe(
      "PASS provider=feishu stage=read card_count=1 sync_ready=true conversation_metadata=true stepfun_summary=true needs_reply=true draft_present=true private_id_fields=false\n"
    );
    for (const value of privateValues) expect(result.output).not.toContain(value);
  }, timeout);

  it("rejects recursively nested private provider identifiers from cards", async () => {
    const baseUrl = await readServer({
      ...publicCard("dingtalk"),
      nested: { openDingtalkId: "private-id" }
    });

    const result = await runSmoke(baseUrl, ["--provider", "dingtalk", "--mode", "read"]);

    expect(result.code).not.toBe(0);
    expect(result.output).toBe(
      "FAIL provider=dingtalk stage=items status=0 error_code=HUSH_SMOKE_PRIVATE_ID_FIELD\n"
    );
  }, timeout);

  it("rejects malformed public cards before reporting a read pass", async () => {
    const malformed = publicCard("feishu");
    delete malformed.reply_targets;
    const baseUrl = await readServer(malformed, "feishu");

    const result = await runSmoke(baseUrl, ["--provider", "feishu", "--mode", "read"]);

    expect(result.code).not.toBe(0);
    expect(result.output).toBe(
      "FAIL provider=feishu stage=items status=0 error_code=HUSH_SMOKE_CARD_INVALID\n"
    );
  }, timeout);

  it("refuses send unless the exact allow-send environment value is set", async () => {
    const baseUrl = await startServer((_request, response) => error(response, 500));
    const result = await runSmoke(
      baseUrl,
      ["--provider", "dingtalk", "--mode", "send", "--item-id", "item-1"],
      { HUSH_SMOKE_ALLOW_SEND: "TRUE" }
    );

    expect(result.code).not.toBe(0);
    expect(result.output).toBe(
      "FAIL provider=dingtalk stage=guard status=0 error_code=HUSH_SMOKE_SEND_DISABLED\n"
    );
  }, timeout);

  it("rejects omitted and dot-segment item IDs before sending", async () => {
    const baseUrl = await startServer((_request, response) => error(response, 500));
    for (const arguments_ of [
      ["--provider", "dingtalk", "--mode", "send"],
      ["--provider", "dingtalk", "--mode", "send", "--item-id", ".."]
    ]) {
      const result = await runSmoke(baseUrl, arguments_, { HUSH_SMOKE_ALLOW_SEND: "true" });
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("stage=arguments status=0");
    }
  }, timeout);

  it("rejects a server-returned dot-segment draft ID before constructing draft paths", async () => {
    const requests: string[] = [];
    const baseUrl = await startServer((request, response) => {
      requests.push(request.url ?? "");
      if (request.url === "/v1/inbox/items/item-42") {
        return json(response, 200, { id: "item-42", provider: "dingtalk", draft_id: ".." });
      }
      return error(response, 500);
    });

    const result = await runSmoke(
      baseUrl,
      ["--provider", "dingtalk", "--mode", "send", "--item-id", "item-42"],
      { HUSH_SMOKE_ALLOW_SEND: "true" }
    );

    expect(result.code).not.toBe(0);
    expect(result.output).toBe(
      "FAIL provider=dingtalk stage=item status=0 error_code=HUSH_SMOKE_DRAFT_ID_INVALID\n"
    );
    expect(requests).toEqual(["/v1/inbox/items/item-42"]);
  }, timeout);

  it("binds send resources and uses one request id for the HTTP header and body", async () => {
    const requests: CapturedRequest[] = [];
    const baseUrl = await startServer(async (request, response) => {
      const body = await readBody(request);
      requests.push({ method: request.method, url: request.url, headers: request.headers, body });
      if (request.url === "/v1/inbox/items/item-42") return json(response, 200, {
        id: "item-42", provider: "dingtalk", draft_id: "draft-42"
      });
      if (request.url === "/v1/inbox/drafts/draft-42") return json(response, 200, {
        id: "draft-42", inbox_item_id: "item-42", version: 7
      });
      if (request.url === "/v1/inbox/drafts/draft-42/confirmation") {
        if (!uuid.test(String(request.headers["x-request-id"]))) return error(response, 400);
        return json(response, 200, {
          confirmation_token: "confirmation-token-000000000000",
          expires_at: "2099-07-24T01:00:00.000Z"
        });
      }
      if (request.url === "/v1/inbox/drafts/draft-42:send") {
        const payload = JSON.parse(body) as { request_id?: string };
        if (payload.request_id !== request.headers["x-request-id"]) return error(response, 400);
        return json(response, 200, {
          draft_id: "draft-42", provider: "dingtalk", status: "sent",
          provider_message_id: "provider-message", sent_at: "2026-07-24T01:00:00.000Z"
        });
      }
      return error(response);
    });

    const result = await runSmoke(
      baseUrl,
      ["--provider", "dingtalk", "--mode", "send", "--item-id", "item-42"],
      { HUSH_SMOKE_ALLOW_SEND: "true" }
    );

    expect(result.code, result.output).toBe(0);
    expect(requests).toHaveLength(4);
    const confirmation = requests[2];
    const send = requests[3];
    if (!confirmation || !send) throw new Error("required requests were not captured");
    expect(confirmation.headers["x-request-id"]).toMatch(uuid);
    expect(send.headers["idempotency-key"]).toMatch(uuid);
    expect(JSON.parse(send.body).request_id).toBe(send.headers["x-request-id"]);
  }, timeout);

  it("rejects mismatched send resources and malformed confirmation or send responses", async () => {
    for (const scenario of ["item", "draft", "confirmation", "send"] as const) {
      const baseUrl = await sendServer(scenario);
      const result = await runSmoke(
        baseUrl,
        ["--provider", "dingtalk", "--mode", "send", "--item-id", "item-42"],
        { HUSH_SMOKE_ALLOW_SEND: "true" }
      );
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("provider=dingtalk");
      expect(result.output).toMatch(/stage=(item|draft|confirmation|send) status=0 error_code=HUSH_SMOKE_/);
    }
  }, timeout);

  it("rejects base URLs with credentials, query strings, or fragments", async () => {
    for (const url of [
      "http://user:pass@127.0.0.1:1",
      "http://127.0.0.1:1/?query=1",
      "http://127.0.0.1:1/#fragment"
    ]) {
      const result = await runSmoke("http://127.0.0.1:1", ["--provider", "feishu", "--mode", "read"], { HUSH_BASE_URL: url });
      expect(result.code).not.toBe(0);
      expect(result.output).toBe(
        "FAIL provider=feishu stage=config status=0 error_code=HUSH_SMOKE_BASE_URL_INVALID\n"
      );
    }
  }, timeout);

  it("sanitizes server failures to provider, stage, status, and Hush error code", async () => {
    const baseUrl = await startServer((request, response) => {
      if (request.url === "/v1/inbox/sync-status") {
        return json(response, 503, { error: { code: "INBOX_PROVIDER_UNAVAILABLE", message: "Sensitive backend failure" } });
      }
      return error(response);
    });
    const result = await runSmoke(baseUrl, ["--provider", "feishu", "--mode", "read"]);
    expect(result.code).not.toBe(0);
    expect(result.output).toBe(
      "FAIL provider=feishu stage=sync_status status=503 error_code=INBOX_PROVIDER_UNAVAILABLE\n"
    );
  }, timeout);
});

type CapturedRequest = { method: string | undefined; url: string | undefined; headers: IncomingHttpHeaders; body: string };

async function readServer(card: Record<string, unknown> = publicCard("dingtalk"), provider = "dingtalk"): Promise<string> {
  return await startServer((request, response) => {
    if (request.url === "/v1/inbox/sync-status") return json(response, 200, [readySync(provider)]);
    if (request.url === "/v1/inbox/items?limit=100") return json(response, 200, { items: [card], next_cursor: null });
    return error(response);
  });
}

async function sendServer(scenario: "item" | "draft" | "confirmation" | "send"): Promise<string> {
  return await startServer((request, response) => {
    if (request.url === "/v1/inbox/items/item-42") return json(response, 200, {
      id: scenario === "item" ? "other-item" : "item-42", provider: "dingtalk", draft_id: "draft-42"
    });
    if (request.url === "/v1/inbox/drafts/draft-42") return json(response, 200, {
      id: "draft-42", inbox_item_id: scenario === "draft" ? "other-item" : "item-42", version: 7
    });
    if (request.url === "/v1/inbox/drafts/draft-42/confirmation") return json(response, 200,
      scenario === "confirmation" ? { confirmation_token: "short", expires_at: "2000-01-01T00:00:00.000Z" } : { confirmation_token: "confirmation-token-000000000000", expires_at: "2099-01-01T00:00:00.000Z" }
    );
    if (request.url === "/v1/inbox/drafts/draft-42:send") return json(response, 200,
      scenario === "send" ? { draft_id: "other-draft", provider: "feishu", status: "sent", provider_message_id: null, sent_at: null } : { draft_id: "draft-42", provider: "dingtalk", status: "sent", provider_message_id: "provider-message", sent_at: null }
    );
    return error(response);
  });
}

function readySync(provider: string) {
  return { provider, account_id: "private-account", status: "ready", checkpoint: "checkpoint", last_synced_at: "2026-07-24T01:00:00.000Z", last_error: null, coverage: { source: "official_api", complete: true, note: null } };
}

function publicCard(provider: string): Record<string, unknown> {
  return { id: "item-public-42", provider, account_id: "private-account", conversation_id: "private-conversation", conversation_type: "group", conversation_name: "private-name", provider_message_id: "private-provider-message", sender: null, sender_ref: null, recipients: [], subject: null, content: null, received_at: "2026-07-24T00:00:00.000Z", coverage: { source: "official_api", complete: true, note: null }, item_kind: "conversation_digest", revision: 2, message_count: 3, window_started_at: "2026-07-24T00:00:00.000Z", window_ended_at: "2026-07-24T01:00:00.000Z", sealed_at: null, acknowledged_at: null, summary: "private-summary", important_points: ["point"], todos: [], priority: "normal", needs_reply: true, reply_targets: [{ target_id: "participant_abcdefgh", display_name: "private-target", reason: "reply needed" }], draft_id: "private-draft", sync_status: "ready" };
}

async function startServer(handler: RequestListener): Promise<string> {
  const server = createHttpServer(handler); servers.push(server);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not expose a TCP port");
  return `http://127.0.0.1:${address.port}`;
}
function closeServer(server: Server): Promise<void> { return new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); }
function json(response: ServerResponse<IncomingMessage>, status: number, body: unknown): void { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); }
function error(response: ServerResponse<IncomingMessage>, status = 404): void { json(response, status, { error: { code: "INBOX_NOT_FOUND" } }); }
async function readBody(request: IncomingMessage): Promise<string> { let body = ""; for await (const chunk of request) body += String(chunk); return body; }
async function runSmoke(baseUrl: string, arguments_: string[], extraEnvironment: Record<string, string> = {}): Promise<{ code: number | null; output: string }> {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...arguments_], { cwd: serverDirectory, env: { ...process.env, HUSH_BASE_URL: baseUrl, HUSH_APP_TOKEN: "app-token-not-for-output", ...extraEnvironment }, windowsHide: true });
    let output = ""; child.stdout.on("data", (chunk) => { output += String(chunk); }); child.stderr.on("data", (chunk) => { output += String(chunk); }); child.on("error", reject); child.on("close", (code) => resolveRun({ code, output }));
  });
}
