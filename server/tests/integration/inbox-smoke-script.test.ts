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
const smokeTestTimeoutMs = 30_000;
const runningServers: Server[] = [];

describe("Unified Inbox external smoke harness", () => {
  afterEach(async () => {
    await Promise.all(runningServers.splice(0).map(closeServer));
  });

  it("validates a provider card without exposing its private contents", async () => {
    const privateValues = {
      account: "account-private-42",
      conversation: "conversation-private-42",
      item: "item-private-42",
      subject: "Private project subject",
      content: "Private source message",
      summary: "Private StepFun summary",
      draft: "Private reply draft",
      name: "Private group name"
    };
    const baseUrl = await startServer((request, response) => {
      if (request.url === "/v1/inbox/sync-status") {
        return json(response, 200, [
          {
            provider: "feishu",
            account_id: privateValues.account,
            status: "ready",
            checkpoint: "checkpoint-private-42",
            last_synced_at: "2026-07-24T01:00:00.000Z",
            last_error: null,
            coverage: { source: "official_api", complete: true, note: null }
          }
        ]);
      }
      if (request.url === "/v1/inbox/items?limit=100") {
        return json(response, 200, {
          items: [
            {
              id: privateValues.item,
              provider: "feishu",
              account_id: privateValues.account,
              conversation_id: privateValues.conversation,
              conversation_type: "group",
              conversation_name: privateValues.name,
              subject: privateValues.subject,
              content: privateValues.content,
              summary: privateValues.summary,
              needs_reply: true,
              draft_id: privateValues.draft
            }
          ],
          next_cursor: null
        });
      }
      return json(response, 404, { error: { code: "INBOX_NOT_FOUND" } });
    });

    const result = await runSmoke(baseUrl, [
      "--provider",
      "feishu",
      "--mode",
      "read"
    ]);

    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("provider=feishu");
    expect(result.output).toContain("stage=read");
    expect(result.output).toContain("card_count=1");
    expect(result.output).toContain("sync_ready=true");
    expect(result.output).toContain("conversation_metadata=true");
    expect(result.output).toContain("stepfun_summary=true");
    expect(result.output).toContain("draft_present=true");
    for (const value of Object.values(privateValues)) {
      expect(result.output).not.toContain(value);
    }
  }, smokeTestTimeoutMs);

  it("refuses send unless the exact allow-send environment value is set", async () => {
    const baseUrl = await startServer((_request, response) => {
      return json(response, 500, { error: { code: "SHOULD_NOT_BE_CALLED" } });
    });

    const result = await runSmoke(
      baseUrl,
      ["--provider", "dingtalk", "--mode", "send", "--item-id", "item-1"],
      { HUSH_SMOKE_ALLOW_SEND: "TRUE" }
    );

    expect(result.code).not.toBe(0);
    expect(result.output).toBe(
      "FAIL provider=dingtalk stage=guard status=0 error_code=HUSH_SMOKE_SEND_DISABLED\n"
    );
  }, smokeTestTimeoutMs);

  it("requires an explicit item id before allowing send", async () => {
    const baseUrl = await startServer((_request, response) => {
      return json(response, 500, { error: { code: "SHOULD_NOT_BE_CALLED" } });
    });

    const result = await runSmoke(baseUrl, [
      "--provider",
      "dingtalk",
      "--mode",
      "send"
    ], { HUSH_SMOKE_ALLOW_SEND: "true" });

    expect(result.code).not.toBe(0);
    expect(result.output).toBe(
      "FAIL provider=dingtalk stage=arguments status=0 error_code=HUSH_SMOKE_ITEM_ID_REQUIRED\n"
    );
  }, smokeTestTimeoutMs);

  it("reads the current draft, confirms it, and sends with a fresh idempotency key", async () => {
    const requests: Array<{
      method: string | undefined;
      url: string | undefined;
      headers: IncomingHttpHeaders;
      body: string;
    }> = [];
    const baseUrl = await startServer(async (request, response) => {
      const body = await readBody(request);
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body
      });
      if (request.method === "GET" && request.url === "/v1/inbox/items/item-42") {
        return json(response, 200, {
          id: "item-42",
          provider: "dingtalk",
          draft_id: "draft-42"
        });
      }
      if (request.method === "GET" && request.url === "/v1/inbox/drafts/draft-42") {
        return json(response, 200, { id: "draft-42", version: 7 });
      }
      if (request.method === "POST" && request.url === "/v1/inbox/drafts/draft-42/confirmation") {
        return json(response, 200, {
          confirmation_token: "confirmation-token-000000000000"
        });
      }
      if (request.method === "POST" && request.url === "/v1/inbox/drafts/draft-42:send") {
        return json(response, 200, { status: "sent" });
      }
      return json(response, 404, { error: { code: "INBOX_NOT_FOUND" } });
    });

    const result = await runSmoke(
      baseUrl,
      ["--provider", "dingtalk", "--mode", "send", "--item-id", "item-42"],
      { HUSH_SMOKE_ALLOW_SEND: "true" }
    );

    expect(result.code, result.output).toBe(0);
    expect(result.output).toBe(
      "PASS provider=dingtalk stage=send sent=true confirmation=true idempotency_fresh=true\n"
    );
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET /v1/inbox/items/item-42",
      "GET /v1/inbox/drafts/draft-42",
      "POST /v1/inbox/drafts/draft-42/confirmation",
      "POST /v1/inbox/drafts/draft-42:send"
    ]);
    const send = requests[3];
    if (!send) {
      throw new Error("send request was not captured");
    }
    expect(send.headers["idempotency-key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(JSON.parse(send.body)).toMatchObject({
      schema_version: "1.0",
      expected_version: 7,
      confirmation_token: "confirmation-token-000000000000"
    });
  }, smokeTestTimeoutMs);

  it("sanitizes server failures to provider, stage, status, and Hush error code", async () => {
    const baseUrl = await startServer((request, response) => {
      if (request.url === "/v1/inbox/sync-status") {
        return json(response, 503, {
          error: {
            code: "INBOX_PROVIDER_UNAVAILABLE",
            message: "Sensitive backend failure detail"
          }
        });
      }
      return json(response, 404, { error: { code: "INBOX_NOT_FOUND" } });
    });

    const result = await runSmoke(baseUrl, [
      "--provider",
      "feishu",
      "--mode",
      "read"
    ]);

    expect(result.code).not.toBe(0);
    expect(result.output).toBe(
      "FAIL provider=feishu stage=sync_status status=503 error_code=INBOX_PROVIDER_UNAVAILABLE\n"
    );
  }, smokeTestTimeoutMs);
});

async function startServer(
  handler: RequestListener
): Promise<string> {
  const server = createHttpServer(handler);
  runningServers.push(server);
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not expose a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
}

function json(
  response: ServerResponse<IncomingMessage>,
  status: number,
  body: unknown
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
  }
  return body;
}

async function runSmoke(
  baseUrl: string,
  arguments_: string[],
  extraEnvironment: Record<string, string> = {}
): Promise<{ code: number | null; output: string }> {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...arguments_], {
      cwd: serverDirectory,
      env: {
        ...process.env,
        HUSH_BASE_URL: baseUrl,
        HUSH_APP_TOKEN: "app-token-not-for-output",
        ...extraEnvironment
      },
      windowsHide: true
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolveRun({ code, output });
    });
  });
}
