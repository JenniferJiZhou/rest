import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020Module, {
  type Ajv2020 as Ajv2020Instance,
  type ValidateFunction
} from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../contracts/schemas/usage-summary.schema.json"),
    "utf8"
  )
) as object;
const Ajv2020 = Ajv2020Module as unknown as {
  new (options?: Record<string, unknown>): Ajv2020Instance;
};
const addFormats = addFormatsModule as unknown as (
  ajv: Ajv2020Instance
) => void;
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false
});
addFormats(ajv);
const validate = ajv.compile(schema) as ValidateFunction;

const websiteUsage = (overrides: Record<string, unknown> = {}) => ({
  schema_version: "1.0",
  request_id: "req_schema_website",
  measured_at: "2026-07-24T04:00:00Z",
  platform: "macos",
  trigger_source: "macos_website_checkpoint",
  target_type: "website",
  website_domain: "music.youtube.com",
  label_source: "domain",
  daily_usage_minutes: 60,
  continuous_usage_minutes: 12,
  continuous_usage_is_estimated: false,
  app_switches_last_10_minutes: 3,
  local_hour: 14,
  minutes_since_last_rest: 180,
  self_reported_energy: null,
  recent_feedback: [],
  full_url_included: false,
  page_title_included: false,
  ...overrides
});

describe("UsageSummary JSON Schema", () => {
  it.each([
    "www.youtube.com",
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "WWW.Example.COM"
  ])("accepts hostname-only website_domain %s", (domain) => {
    expect(validate(websiteUsage({ website_domain: domain }))).toBe(true);
  });

  it.each([
    "https://youtube.com",
    "youtube.com/watch",
    "youtube.com?q=hush",
    "youtube.com#rest",
    "user@youtube.com",
    "youtube.com:443",
    "music..youtube.com"
  ])("rejects non-hostname website_domain %s", (domain) => {
    expect(validate(websiteUsage({ website_domain: domain }))).toBe(false);
  });

  it.each([
    { full_url_included: true },
    { page_title_included: true },
    { continuous_usage_is_estimated: true }
  ])("rejects unsafe website inclusion flags", (overrides) => {
    expect(validate(websiteUsage(overrides))).toBe(false);
  });

  it("rejects legacy fields mixed into a current website request", () => {
    expect(
      validate(websiteUsage({ continuous_screen_minutes: 12 }))
    ).toBe(false);
  });

  it("accepts null only for a domain-labelled website", () => {
    expect(
      validate(
        websiteUsage({
          label_source: "domain",
          user_provided_context_label: null
        })
      )
    ).toBe(true);
    expect(
      validate(
        websiteUsage({
          label_source: "user",
          user_provided_context_label: null
        })
      )
    ).toBe(false);
  });
});
