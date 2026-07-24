import { describe, expect, it } from "vitest";
import { usageSummarySchema } from "../../src/domain/contracts.js";

const currentUsage = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  schema_version: "1.0",
  request_id: "req_ios_current",
  measured_at: "2026-07-24T04:00:00Z",
  platform: "ios",
  trigger_source: "device_activity_threshold",
  user_provided_context_label: "小红书",
  daily_app_usage_minutes: 35,
  estimated_continuous_app_usage_minutes: 15,
  continuous_usage_is_estimated: true,
  app_switches_last_10_minutes: null,
  local_hour: 14,
  minutes_since_last_rest: 180,
  self_reported_energy: null,
  recent_feedback: [],
  raw_app_names_included: false,
  ...overrides
});

const macAppUsage = (overrides: Record<string, unknown> = {}) => ({
  schema_version: "1.0",
  request_id: "req_mac_app",
  measured_at: "2026-07-24T04:00:00Z",
  platform: "macos",
  trigger_source: "macos_usage_checkpoint",
  user_provided_context_label: "写作",
  daily_app_usage_minutes: 60,
  continuous_app_usage_minutes: 12,
  continuous_usage_is_estimated: false,
  app_switches_last_10_minutes: 3,
  local_hour: 14,
  minutes_since_last_rest: 180,
  self_reported_energy: null,
  recent_feedback: [],
  raw_app_names_included: false,
  ...overrides
});

const macWebsiteUsage = (overrides: Record<string, unknown> = {}) => ({
  schema_version: "1.0",
  request_id: "req_mac_website",
  measured_at: "2026-07-24T04:00:00Z",
  platform: "macos",
  trigger_source: "macos_website_checkpoint",
  target_type: "website",
  website_domain: "youtube.com",
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

describe("UsageSummary current and legacy compatibility", () => {
  it("accepts the current iOS DeviceActivity request", () => {
    const result = usageSummarySchema.parse(currentUsage());

    expect(result.user_provided_context_label).toBe("小红书");
  });

  it.each([
    ["Chinese", "小红书"],
    ["English", "Focus App"],
    ["numbers and punctuation", "工作 2.0（专注）"]
  ])("accepts a normal %s user label", (_case, label) => {
    expect(
      usageSummarySchema.parse(
        currentUsage({ user_provided_context_label: label })
      ).user_provided_context_label
    ).toBe(label);
  });

  it("trims and NFC-normalizes the user label", () => {
    const result = usageSummarySchema.parse(
      currentUsage({ user_provided_context_label: "  Cafe\u0301  " })
    );

    expect(result.user_provided_context_label).toBe("Café");
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["over 80 characters", "界".repeat(81)],
    ["NUL", "work\u0000chat"],
    ["newline", "work\nchat"],
    ["carriage return", "work\rchat"],
    ["tab", "work\tchat"],
    ["C1 control", "work\u0085chat"]
  ])("rejects a %s user label", (_case, label) => {
    expect(
      usageSummarySchema.safeParse(
        currentUsage({ user_provided_context_label: label })
      ).success
    ).toBe(false);
  });

  it.each([
    ["negative daily usage", { daily_app_usage_minutes: -1 }],
    [
      "daily usage over one day",
      { daily_app_usage_minutes: 1441 }
    ],
    [
      "negative estimated usage",
      { estimated_continuous_app_usage_minutes: -1 }
    ],
    [
      "estimated usage over one day",
      { estimated_continuous_app_usage_minutes: 1441 }
    ],
    [
      "estimated usage above daily usage",
      {
        daily_app_usage_minutes: 10,
        estimated_continuous_app_usage_minutes: 11
      }
    ],
    [
      "non-estimated iOS DeviceActivity signal",
      { continuous_usage_is_estimated: false }
    ],
    ["raw app names", { raw_app_names_included: true }],
    ["invalid measured_at", { measured_at: "not-a-date" }],
    ["local hour below range", { local_hour: -1 }],
    ["local hour above range", { local_hour: 24 }]
  ])("rejects %s", (_case, overrides) => {
    expect(
      usageSummarySchema.safeParse(currentUsage(overrides)).success
    ).toBe(false);
  });

  it.each([
    "user_provided_context_label",
    "daily_app_usage_minutes",
    "estimated_continuous_app_usage_minutes",
    "continuous_usage_is_estimated"
  ])("requires current field %s when current format is used", (field) => {
    const payload = currentUsage();
    delete payload[field];

    expect(usageSummarySchema.safeParse(payload).success).toBe(false);
  });

  it("continues to accept the legacy format", () => {
    expect(
      usageSummarySchema.safeParse({
        schema_version: "1.0",
        request_id: "req_legacy",
        measured_at: "2026-07-24T15:20:00+08:00",
        platform: "ios",
        trigger_source: "manual_ios",
        continuous_screen_minutes: null,
        app_switches_last_10_minutes: null,
        local_hour: 15,
        minutes_since_last_rest: 96,
        self_reported_energy: 3,
        recent_feedback: [],
        raw_app_names_included: false
      }).success
    ).toBe(true);
  });

  it("accepts a legacy DeviceActivity request", () => {
    expect(
      usageSummarySchema.safeParse({
        schema_version: "1.0",
        request_id: "req_legacy_device_activity",
        measured_at: "2026-07-24T15:20:00+08:00",
        platform: "ios",
        trigger_source: "device_activity_threshold",
        continuous_screen_minutes: 20,
        app_switches_last_10_minutes: null,
        local_hour: 15,
        minutes_since_last_rest: 96,
        self_reported_energy: null,
        recent_feedback: [],
        raw_app_names_included: false
      }).success
    ).toBe(true);
  });

  it("rejects a request containing current and legacy usage fields", () => {
    expect(
      usageSummarySchema.safeParse(
        currentUsage({ continuous_screen_minutes: 15 })
      ).success
    ).toBe(false);
  });

  it("accepts the current Mac App usage checkpoint", () => {
    expect(usageSummarySchema.safeParse(macAppUsage()).success).toBe(true);
  });

  it("accepts the current Mac website checkpoint", () => {
    expect(usageSummarySchema.safeParse(macWebsiteUsage()).success).toBe(
      true
    );
  });

  it("keeps macos_rule as a legacy trigger", () => {
    expect(
      usageSummarySchema.safeParse({
        ...macAppUsage({
          trigger_source: "macos_rule",
          continuous_screen_minutes: 20
        }),
        user_provided_context_label: undefined,
        daily_app_usage_minutes: undefined,
        continuous_app_usage_minutes: undefined,
        continuous_usage_is_estimated: undefined
      }).success
    ).toBe(true);
  });

  it.each([
    ["www.youtube.com", "youtube.com"],
    ["youtube.com", "youtube.com"],
    ["m.youtube.com", "m.youtube.com"],
    ["music.youtube.com", "music.youtube.com"],
    ["WWW.Example.COM", "example.com"]
  ])("normalizes website hostname %s to %s", (input, expected) => {
    const result = usageSummarySchema.parse(
      macWebsiteUsage({ website_domain: input })
    );

    expect(result.website_domain).toBe(expected);
  });

  it.each([
    ["scheme", "https://youtube.com"],
    ["path", "youtube.com/watch"],
    ["query", "youtube.com?q=hush"],
    ["fragment", "youtube.com#rest"],
    ["userinfo", "user@youtube.com"],
    ["port", "youtube.com:443"],
    ["empty label", "-youtube.com"],
    ["trailing hyphen", "youtube-.com"],
    ["double dot", "music..youtube.com"]
  ])("rejects website_domain containing %s", (_case, domain) => {
    expect(
      usageSummarySchema.safeParse(
        macWebsiteUsage({ website_domain: domain })
      ).success
    ).toBe(false);
  });

  it("does not merge website subdomains", () => {
    const mobile = usageSummarySchema.parse(
      macWebsiteUsage({ website_domain: "m.youtube.com" })
    );
    const music = usageSummarySchema.parse(
      macWebsiteUsage({ website_domain: "music.youtube.com" })
    );

    expect(mobile.website_domain).toBe("m.youtube.com");
    expect(music.website_domain).toBe("music.youtube.com");
  });

  it.each([
    ["full URL", { full_url_included: true }],
    ["page title", { page_title_included: true }],
    ["estimated website usage", { continuous_usage_is_estimated: true }]
  ])("rejects a Mac website payload including %s", (_case, overrides) => {
    expect(
      usageSummarySchema.safeParse(macWebsiteUsage(overrides)).success
    ).toBe(false);
  });

  it("requires a user label when website label_source is user", () => {
    expect(
      usageSummarySchema.safeParse(
        macWebsiteUsage({
          label_source: "user",
          user_provided_context_label: undefined
        })
      ).success
    ).toBe(false);
  });

  it("accepts a normalized user label for a website", () => {
    const result = usageSummarySchema.parse(
      macWebsiteUsage({
        label_source: "user",
        user_provided_context_label: "  学习  "
      })
    );

    expect(result.user_provided_context_label).toBe("学习");
  });

  it("accepts an explicit null label for a domain-labelled website", () => {
    const result = usageSummarySchema.parse(
      macWebsiteUsage({
        label_source: "domain",
        user_provided_context_label: null
      })
    );

    expect(result.user_provided_context_label).toBeNull();
  });

  it.each([
    currentUsage({ user_provided_context_label: null }),
    macAppUsage({ user_provided_context_label: null }),
    macWebsiteUsage({
      label_source: "user",
      user_provided_context_label: null
    })
  ])("rejects null when a user label is required", (payload) => {
    expect(usageSummarySchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    [
      "iOS and Mac App fields",
      currentUsage({ continuous_app_usage_minutes: 15 })
    ],
    [
      "Mac App and iOS estimated fields",
      macAppUsage({ estimated_continuous_app_usage_minutes: 12 })
    ],
    [
      "website and App usage fields",
      macWebsiteUsage({ daily_app_usage_minutes: 60 })
    ]
  ])("rejects mixed current shapes: %s", (_case, payload) => {
    expect(usageSummarySchema.safeParse(payload).success).toBe(false);
  });
});
