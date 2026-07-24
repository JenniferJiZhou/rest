import { describe, expect, it } from "vitest";
import {
  FIXTURE_CONTRACTS,
  createContractValidator
} from "../../src/infra/contract-validator.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { usageSummarySchema } from "../../src/domain/contracts.js";

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
    "usage-summary-manual-ios.json",
    "usage-summary-device-activity-ios.json",
    "usage-summary-macos-app.json",
    "usage-summary-macos-website.json",
    "usage-summary-macos-website-user-label.json"
  ])("%s also matches the runtime Zod contract", (fixture) => {
    const input = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "../contracts/fixtures", fixture),
        "utf8"
      )
    ) as unknown;

    expect(usageSummarySchema.safeParse(input).success).toBe(true);
  });
});
