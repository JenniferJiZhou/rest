import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApplicationServer } from "../../src/bootstrap.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(
  repositoryRoot,
  "scripts/smoke-unified-inbox.ps1"
);
const powershellExecutable =
  process.platform === "win32" ? "powershell.exe" : "pwsh";
const timeoutMs = 30_000;
const servers: FastifyInstance[] = [];

describe("Unified Inbox smoke script", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("does not access the network without an explicit BaseUrl", async () => {
    const result = await runSmoke([]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("no network request was made");
  }, timeoutMs);

  it("rejects HTTP when remote HTTPS mode is selected", async () => {
    const result = await runSmoke([
      "-BaseUrl",
      "http://127.0.0.1:3000"
    ]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("HTTPS smoke requires an https BaseUrl");
  }, timeoutMs);

  it("runs locally without sending unless AllowSimulatedSend is explicit", async () => {
    const first = await startCannedServer();
    const defaultRun = await runSmoke([
      "-BaseUrl",
      first.baseUrl,
      "-Mode",
      "LocalHttp"
    ]);
    expect(defaultRun.code).toBe(0);
    expect(defaultRun.output).toContain(
      "PASS Unified Inbox smoke summary"
    );
    expect(defaultRun.output).not.toContain(
      "PASS simulated send was explicitly enabled"
    );
    const draftAfterDefault = await fetch(
      `${first.baseUrl}/v1/inbox/drafts/draft_feishu_001`,
      {
        headers: protocolHeaders("req_smoke_verify_default")
      }
    );
    expect(
      ((await draftAfterDefault.json()) as {
        draft: { status: string };
      }).draft.status
    ).toBe("confirmed");

    const second = await startCannedServer();
    const explicitSend = await runSmoke([
      "-BaseUrl",
      second.baseUrl,
      "-Mode",
      "LocalHttp",
      "-AllowSimulatedSend"
    ]);
    expect(explicitSend.code).toBe(0);
    expect(explicitSend.output).toContain(
      "PASS simulated send was explicitly enabled"
    );
    expect(explicitSend.output).not.toContain("confirmation_");
    expect(explicitSend.output).not.toContain(
      "Synthetic Unified Inbox smoke reply"
    );
  }, timeoutMs);
});

async function startCannedServer(): Promise<{
  server: FastifyInstance;
  baseUrl: string;
}> {
  const server = createApplicationServer({
    NODE_ENV: "test",
    HUSH_UNIFIED_INBOX_PROVIDER: "canned",
    LOG_LEVEL: "silent"
  });
  const baseUrl = await server.listen({
    host: "127.0.0.1",
    port: 0
  });
  servers.push(server);
  return { server, baseUrl };
}

function protocolHeaders(requestId: string): Record<string, string> {
  return {
    "x-request-id": requestId,
    "x-client-version": "1.0.0-test",
    "x-contract-version": "1.0"
  };
}

async function runSmoke(
  arguments_: string[]
): Promise<{ code: number | null; output: string }> {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(
      powershellExecutable,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        ...arguments_
      ],
      {
        cwd: repositoryRoot,
        windowsHide: true
      }
    );
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
