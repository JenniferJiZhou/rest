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
    expect(result.output).toContain("no network request was made");
  }, smokeTestTimeoutMs);

  it("rejects a remote HTTP BaseUrl", async () => {
    const result = await runSmoke([
      "-BaseUrl",
      "http://example.com"
    ]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain(
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

    expect(result.code).toBe(0);
    expect(result.output).toContain("PASS health");
    expect(result.output).toContain("PASS Offer HTTP 200");
    expect(result.output).toContain("PASS Companion HTTP 200");
    expect(result.output).toContain("PASS Manual HTTP 200");
    expect(result.output).toContain(
      "PASS dynamic rest decision smoke summary"
    );
    expect(result.output).not.toContain("Smoke dynamic app");
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

    expect(result.code).toBe(0);
    expect(result.output).toContain("PASS health");
    expect(result.output).toContain("PASS Offer HTTP 503");
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

    expect(result.code).toBe(0);
    expect(result.output).toContain("PASS health");
    expect(result.output).toContain("PASS Manual HTTP 503");
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
    expect(result.output).toContain("X-Hush-Data-Origin mismatch");
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
