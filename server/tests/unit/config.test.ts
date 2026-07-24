import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("server listener configuration", () => {
  it("defaults to a loopback-only listener", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent"
    });

    expect(config.HOST).toBe("127.0.0.1");
    expect(config.PORT).toBe(3000);
    expect(config.HUSH_REST_DECISION_PROVIDER).toBe("canned");
  });

  it("allows an explicit unavailable Rest Decision test provider", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      HUSH_REST_DECISION_PROVIDER: "unavailable",
      LOG_LEVEL: "silent"
    });

    expect(config.HUSH_REST_DECISION_PROVIDER).toBe("unavailable");
  });

  it("accepts real Rest Decision configuration with a bounded default timeout", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      HUSH_REST_DECISION_PROVIDER: "real",
      CLAUDE_API_KEY: "not-used-in-test",
      REST_DECISION_MODEL: "claude-test-model",
      CLAUDE_BASE_URL: "https://model.example.test",
      LOG_LEVEL: "silent"
    });

    expect(config).toMatchObject({
      HUSH_REST_DECISION_PROVIDER: "real",
      REST_DECISION_MODEL: "claude-test-model",
      CLAUDE_BASE_URL: "https://model.example.test",
      REST_DECISION_TIMEOUT_MS: 3500
    });
  });

  it("allows an explicit trusted-LAN listener and custom port", () => {
    const config = loadConfig({
      NODE_ENV: "demo",
      HOST: "0.0.0.0",
      PORT: "4310",
      HUSH_DEMO_MODE: "true",
      HUSH_DEMO_TOKEN: "local-demo-token",
      LOG_LEVEL: "silent"
    });

    expect(config.HOST).toBe("0.0.0.0");
    expect(config.PORT).toBe(4310);
  });

  it("provides bounded provider timeout defaults", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent"
    });

    expect(config).toMatchObject({
      LLM_TIMEOUT_MS: 15_000,
      MAIL_FETCH_TIMEOUT_MS: 10_000,
      DRAFT_CREATE_TIMEOUT_MS: 10_000,
      COMPLETION_SEND_TIMEOUT_MS: 5_000
    });
  });

  it.each([
    ["LLM_TIMEOUT_MS", "0"],
    ["REST_DECISION_TIMEOUT_MS", "499"],
    ["REST_DECISION_TIMEOUT_MS", "4501"],
    ["MAIL_FETCH_TIMEOUT_MS", "-1"],
    ["DRAFT_CREATE_TIMEOUT_MS", "NaN"],
    ["COMPLETION_SEND_TIMEOUT_MS", "120001"]
  ])("rejects invalid %s=%s", (name, value) => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        [name]: value
      })
    ).toThrow("Invalid server configuration");
  });
});
