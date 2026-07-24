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
      COMPLETION_SEND_TIMEOUT_MS: 5_000,
      INBOX_POLL_INTERVAL_MS: 30_000
    });
  });

  it.each([
    ["LLM_TIMEOUT_MS", "0"],
    ["MAIL_FETCH_TIMEOUT_MS", "-1"],
    ["DRAFT_CREATE_TIMEOUT_MS", "NaN"],
    ["COMPLETION_SEND_TIMEOUT_MS", "120001"],
    ["INBOX_POLL_INTERVAL_MS", "99"]
  ])("rejects invalid %s=%s", (name, value) => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        [name]: value
      })
    ).toThrow("Invalid server configuration");
  });

  it("accepts empty optional Inbox credentials as unconfigured", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      LARK_CLI_PATH: "",
      DWS_CLI_PATH: "",
      OUTLOOK_ACCESS_TOKEN: "",
      QQ_EMAIL_AUTH_CODE: "",
      HUSH_APP_TOKEN: "",
      HUSH_CONNECTOR_TOKEN: ""
    });

    expect(config.LARK_CLI_PATH).toBeUndefined();
    expect(config.OUTLOOK_ACCESS_TOKEN).toBeUndefined();
    expect(config.QQ_EMAIL_AUTH_CODE).toBeUndefined();
  });

  it("rejects interchangeable App and Connector credentials", () => {
    const shared = "shared-token-00000000000000000000";
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        HUSH_APP_TOKEN: shared,
        HUSH_CONNECTOR_TOKEN: shared
      })
    ).toThrow(/must be different/u);
  });
});
