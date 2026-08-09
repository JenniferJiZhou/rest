import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dynamicRestTaskRecommendationSchema,
  inboxAcknowledgeRequestSchema,
  inboxDraftSchema,
  inboxEventBatchSchema,
  restRecommendationRequestV1_1Schema,
  unifiedInboxItemSchema,
  usageSummarySchema
} from "../../src/domain/contracts.js";
import {
  FIXTURE_CONTRACTS,
  createContractValidator
} from "../../src/infra/contract-validator.js";
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(
  currentDirectory,
  "../../../contracts/fixtures"
);

describe("contract fixtures", () => {
  const validator = createContractValidator();

  for (const contract of FIXTURE_CONTRACTS) {
    it(`${contract.fixture} matches ${contract.schema}`, () => {
      const result = validator.validateFixture(contract);
      expect(result.errors, JSON.stringify(result.errors, null, 2)).toBeNull();
      expect(result.valid).toBe(true);
    });
  }

  it("registers the group digest fixture for JSON Schema validation", () => {
    expect(FIXTURE_CONTRACTS).toContainEqual({
      fixture: "inbox-group-digest-demo.json",
      schema: "inbox-item.schema.json"
    });
  });

  it.each([
    ["inbox-event-batch-demo.json", inboxEventBatchSchema],
    ["inbox-item-enriched-demo.json", unifiedInboxItemSchema],
    ["inbox-draft-edited-demo.json", inboxDraftSchema]
  ])("parses %s with its Zod contract", (fixture, schema) => {
    const value = JSON.parse(
      readFileSync(resolve(fixtureDirectory, fixture), "utf8")
    ) as unknown;

    expect(schema.safeParse(value).success).toBe(true);
  });

  it("parses the group conversation digest fixture", () => {
    const digest = unifiedInboxItemSchema.parse(
      JSON.parse(
        readFileSync(
          resolve(fixtureDirectory, "inbox-group-digest-demo.json"),
          "utf8"
        )
      ) as unknown
    );

    expect(digest).toMatchObject({
      provider: "dingtalk",
      conversation_type: "group",
      item_kind: "conversation_digest",
      sender: null,
      revision: 3,
      message_count: 18
    });
    expect(digest.conversation_name).toBe("产品讨论组");
    expect(digest.reply_targets).toEqual([
      {
        target_id: "participant_demo_0001",
        display_name: "王同学",
        reason: "需要确认接口交付时间"
      }
    ]);
    expect("sender_provider_id" in digest).toBe(false);
  });

  it("parses an inbox acknowledgement request", () => {
    expect(
      inboxAcknowledgeRequestSchema.parse({
        schema_version: "1.0",
        request_id: "req_ack_demo",
        expected_revision: 3
      })
    ).toMatchObject({ expected_revision: 3 });
  });

  it.each([
    ["sender", "leaked-sender"],
    ["sender_ref", "participant_demo_0002"],
    ["content", "leaked raw message content"]
  ])(
    "rejects a group digest with non-null %s in Zod and JSON Schema",
    (field, value) => {
      const digest = JSON.parse(
        readFileSync(
          resolve(fixtureDirectory, "inbox-group-digest-demo.json"),
          "utf8"
        )
      ) as Record<string, unknown>;
      const invalidDigest = { ...digest, [field]: value };

      expect(unifiedInboxItemSchema.safeParse(invalidDigest).success).toBe(
        false
      );
      const result = validator.validateValue(
        {
          fixture: "inbox-group-digest-demo.json",
          schema: "inbox-item.schema.json"
        },
        invalidDigest
      );
      expect(result.errors).not.toBeNull();
      expect(result.valid).toBe(false);
    }
  );

  it.each([
    "usage-summary-manual-ios.json",
    "usage-summary-device-activity-ios.json",
    "usage-summary-macos-app.json",
    "usage-summary-macos-website.json",
    "usage-summary-macos-website-user-label.json"
  ])("%s also matches the runtime Zod contract", (fixture) => {
    const input = JSON.parse(
      readFileSync(resolve(fixtureDirectory, fixture), "utf8")
    ) as unknown;

    expect(usageSummarySchema.safeParse(input).success).toBe(true);
  });

  it.each([
    [
      "rest-recommendation-dynamic-request.json",
      restRecommendationRequestV1_1Schema
    ],
    [
      "rest-recommendation-dynamic-success.json",
      dynamicRestTaskRecommendationSchema
    ]
  ])("%s matches the runtime dynamic manual-rest contract", (
    fixture,
    schema
  ) => {
    const input = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "../contracts/fixtures", fixture),
        "utf8"
      )
    ) as unknown;

    expect(schema.safeParse(input).success).toBe(true);
  });

  const settingsTestRequest = {
    schema_version: "1.1",
    request_id: "req_settings_agent_test_ios",
    session_id: "session_settings_agent_test_ios",
    fatigue_type: "unknown",
    user_preference: "surprise",
    available_minutes: 3,
    source: "settings_agent_test_ios",
    location_tags: [],
    decision_context: {
      measured_at: "2026-08-09T10:15:00+08:00",
      platform: "ios",
      user_provided_context_label: "阅读",
      daily_app_usage_minutes: 35,
      continuous_app_usage_minutes: 15,
      continuous_usage_is_estimated: true,
      app_switches_last_10_minutes: null,
      minutes_since_last_rest: 90,
      local_hour: 10,
      raw_app_names_included: false,
      full_url_included: false,
      page_title_included: false,
      learning_eligible: false
    }
  };

  it("accepts a privacy-bounded iOS settings Agent test context", () => {
    expect(
      restRecommendationRequestV1_1Schema.parse(settingsTestRequest)
    ).toMatchObject(settingsTestRequest);
  });

  it("accepts explicit nulls for unavailable settings test measurements", () => {
    const decisionContext = settingsTestRequest.decision_context;

    expect(
      restRecommendationRequestV1_1Schema.safeParse({
        ...settingsTestRequest,
        decision_context: {
          ...decisionContext,
          user_provided_context_label: null,
          daily_app_usage_minutes: null,
          continuous_app_usage_minutes: null,
          continuous_usage_is_estimated: null,
          app_switches_last_10_minutes: null,
          minutes_since_last_rest: null
        }
      }).success
    ).toBe(true);
  });

  it.each([
    ["learning eligibility", { learning_eligible: true }],
    ["raw App names", { raw_app_names_included: true }],
    ["full URLs", { full_url_included: true }],
    ["page titles", { page_title_included: true }],
    ["private extra fields", { bundle_id: "com.example.private" }],
    ["negative daily minutes", { daily_app_usage_minutes: -1 }],
    ["out-of-range local hour", { local_hour: 24 }]
  ])("rejects settings Agent context with %s", (_name, override) => {
    expect(
      restRecommendationRequestV1_1Schema.safeParse({
        ...settingsTestRequest,
        decision_context: {
          ...settingsTestRequest.decision_context,
          ...override
        }
      }).success
    ).toBe(false);
  });

  it("requires decision context for a settings test source", () => {
    const { decision_context: _decisionContext, ...withoutContext } =
      settingsTestRequest;

    expect(
      restRecommendationRequestV1_1Schema.safeParse(withoutContext).success
    ).toBe(false);
  });

  it("rejects decision context on a non-settings source", () => {
    expect(
      restRecommendationRequestV1_1Schema.safeParse({
        ...settingsTestRequest,
        source: "manual_rest"
      }).success
    ).toBe(false);
  });

  it.each([
    ["settings_agent_test_ios", "macos"],
    ["settings_agent_test_macos", "ios"]
  ])("rejects %s with platform %s", (source, platform) => {
    expect(
      restRecommendationRequestV1_1Schema.safeParse({
        ...settingsTestRequest,
        source,
        decision_context: {
          ...settingsTestRequest.decision_context,
          platform
        }
      }).success
    ).toBe(false);
  });
});
