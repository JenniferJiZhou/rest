import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  inboxDraftSchema,
  inboxEventBatchSchema,
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
});
