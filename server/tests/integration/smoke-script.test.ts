import { createServer as createHttpServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApplicationServer } from "../../src/bootstrap.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(
  repositoryRoot,
  "scripts/smoke-https-staging.ps1"
);
const powershellExecutable =
  process.platform === "win32" ? "powershell.exe" : "pwsh";
const fastifyServers: FastifyInstance[] = [];

describe("HTTPS staging smoke script", () => {
  afterEach(async () => {
    await Promise.all(
      fastifyServers.splice(0).map((server) => server.close())
    );
  });

  it("does not access the network without an explicit BaseUrl", async () => {
    const result = await runSmoke([]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("no network request was made");
  });

  it("rejects HTTP in HTTPS mode", async () => {
    const result = await runSmoke([
      "-BaseUrl",
      "http://127.0.0.1:3000"
    ]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("HTTPS smoke requires an https BaseUrl");
  });

  it("passes all local payloads without printing the Demo Token", async () => {
    const demoToken = "nonprinting-demo-secret";
    const server = createApplicationServer({
      NODE_ENV: "test",
      HUSH_DEMO_MODE: "true",
      HUSH_DEMO_TOKEN: demoToken,
      LOG_LEVEL: "silent"
    });
    const baseUrl = await server.listen({
      host: "127.0.0.1",
      port: 0
    });
    fastifyServers.push(server);

    const result = await runSmoke([
      "-BaseUrl",
      baseUrl,
      "-Mode",
      "LocalHttp",
      "-DemoToken",
      demoToken
    ]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("PASS smoke summary");
    expect(result.output).not.toContain(demoToken);
  });

  it.each([
    ["header mismatch", "wrong-header", "request", 200],
    ["request_id mismatch", "request", "wrong-body", 200],
    ["unexpected status", "request", "request", 201]
  ])(
    "fails on %s",
    async (_name, headerMode, bodyMode, status) => {
      const server = createHttpServer((request, response) => {
        if (request.url === "/v1/health") {
          response.writeHead(200, {
            "content-type": "application/json"
          });
          response.end(
            JSON.stringify({
              status: "ok",
              contract_version: "1.0"
            })
          );
          return;
        }
        const requestId = String(request.headers["x-request-id"]);
        response.writeHead(status, {
          "content-type": "application/json",
          "x-request-id":
            headerMode === "request" ? requestId : headerMode,
          "x-contract-version": "1.0",
          "x-hush-data-origin": "mock"
        });
        response.end(
          JSON.stringify({
            schema_version: "1.0",
            request_id:
              bodyMode === "request" ? requestId : bodyMode,
            should_offer_rest: true,
            reason_code: "long_continuous_use",
            message: "Take a pause.",
            default_quest_id: "look_far_01",
            actions: ["start_rest_session"]
          })
        );
      });
      await new Promise<void>((resolveListen) => {
        server.listen(0, "127.0.0.1", resolveListen);
      });
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("test server did not expose a TCP port");
      }

      try {
        const result = await runSmoke([
          "-BaseUrl",
          `http://127.0.0.1:${address.port}`,
          "-Mode",
          "LocalHttp"
        ]);
        expect(result.code).not.toBe(0);
        expect(result.output).toContain("FAIL");
      } finally {
        await new Promise<void>((resolveClose, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolveClose();
          });
        });
      }
    }
  );
});

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
