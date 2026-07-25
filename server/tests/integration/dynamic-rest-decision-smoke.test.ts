import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApplicationServer } from "../../src/bootstrap.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const script = resolve(
  repositoryRoot,
  "scripts/smoke-dynamic-rest-decision.ps1"
);
const powershellExecutable =
  process.platform === "win32" ? "powershell.exe" : "pwsh";
const smokeTestTimeoutMs = 45_000;
const servers: FastifyInstance[] = [];

describe("Contract 1.1 dynamic Rest Decision smoke script", () => {
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => server.close())
    );
  });

  it("does not access the network without an explicit BaseUrl", async () => {
    const result = await runSmoke([]);

    expect(result.code).not.toBe(0);
    expect(combinedOutput(result)).toContain(
      "no network request was made"
    );
  }, smokeTestTimeoutMs);

  it("rejects a remote HTTP BaseUrl", async () => {
    const result = await runSmoke([
      "-BaseUrl",
      "http://example.com"
    ]);

    expect(result.code).not.toBe(0);
    expect(combinedOutput(result)).toContain(
      "Remote BaseUrl must use HTTPS"
    );
  }, smokeTestTimeoutMs);

  it("validates both Canned Contract 1.1 outcomes locally", async () => {
    const baseUrl = await listen("canned");

    const result = await runSmoke([
      "-BaseUrl",
      baseUrl,
      "-ExpectedDataOrigin",
      "mock",
      "-FixtureMode",
      "All"
    ]);

    assertSmokeSucceeded(result);
    expect(result.stdout).toContain("PASS health");
    expect(result.stdout).toContain("PASS Offer HTTP 200");
    expect(result.stdout).toContain("PASS Companion HTTP 200");
    expect(result.stdout).toContain("PASS Manual HTTP 200");
    expect(result.stdout).toContain(
      "PASS dynamic rest decision smoke summary"
    );
    expect(combinedOutput(result)).not.toContain("Smoke dynamic app");
  }, smokeTestTimeoutMs);

  it("validates the versioned unavailable response locally", async () => {
    const baseUrl = await listen("unavailable");

    const result = await runSmoke([
      "-BaseUrl",
      baseUrl,
      "-ExpectedDataOrigin",
      "mock",
      "-ExpectProviderUnavailable",
      "-FixtureMode",
      "Offer"
    ]);

    assertSmokeSucceeded(result);
    expect(result.stdout).toContain("PASS health");
    expect(result.stdout).toContain("PASS Offer HTTP 503");
  }, smokeTestTimeoutMs);

  it("validates unavailable Contract 1.1 manual generation locally", async () => {
    const baseUrl = await listen("unavailable");

    const result = await runSmoke([
      "-BaseUrl",
      baseUrl,
      "-ExpectedDataOrigin",
      "mock",
      "-ExpectProviderUnavailable",
      "-FixtureMode",
      "Manual"
    ]);

    assertSmokeSucceeded(result);
    expect(result.stdout).toContain("PASS health");
    expect(result.stdout).toContain("PASS Manual HTTP 503");
  }, smokeTestTimeoutMs);

  it("fails when X-Hush-Data-Origin is not the expected value", async () => {
    const baseUrl = await listen("canned");

    const result = await runSmoke([
      "-BaseUrl",
      baseUrl,
      "-ExpectedDataOrigin",
      "real",
      "-FixtureMode",
      "Companion"
    ]);

    expect(result.code).not.toBe(0);
    expect(combinedOutput(result)).toContain(
      "X-Hush-Data-Origin mismatch"
    );
  }, smokeTestTimeoutMs);
});

async function listen(
  provider: "canned" | "unavailable"
): Promise<string> {
  const server = createApplicationServer({
    NODE_ENV: "test",
    HUSH_REST_DECISION_PROVIDER: provider,
    LOG_LEVEL: "silent"
  });
  const baseUrl = await server.listen({
    host: "127.0.0.1",
    port: 0
  });
  servers.push(server);
  return baseUrl;
}

async function runSmoke(
  arguments_: string[]
): Promise<SmokeResult> {
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
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (
      callback: () => void
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const timeout = setTimeout(() => {
      child.kill();
      settle(() => {
        reject(
          new Error(
            formatSmokeFailure(
              "Smoke timed out and was killed.",
              { code: null, stdout, stderr }
            )
          )
        );
      });
    }, 30_000);
    child.on("error", (error) => {
      settle(() => {
        reject(
          new Error(
            formatSmokeFailure(
              `Smoke process failed to start: ${error.message}`,
              { code: null, stdout, stderr }
            )
          )
        );
      });
    });
    child.on("close", (code) => {
      settle(() => {
        resolveRun({ code, stdout, stderr });
      });
    });
  });
}

interface SmokeResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function combinedOutput(result: SmokeResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

function assertSmokeSucceeded(result: SmokeResult): void {
  if (result.code !== 0) {
    throw new Error(
      formatSmokeFailure(
        `Smoke exited with code ${String(result.code)}.`,
        result
      )
    );
  }
}

function formatSmokeFailure(
  summary: string,
  result: SmokeResult
): string {
  return [
    summary,
    "--- stdout ---",
    sanitizeSmokeOutput(result.stdout),
    "--- stderr ---",
    sanitizeSmokeOutput(result.stderr)
  ].join("\n");
}

function sanitizeSmokeOutput(output: string): string {
  return output
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(
      /(api[_-]?key|token|secret)\s*[:=]\s*\S+/giu,
      "$1=[REDACTED]"
    );
}
