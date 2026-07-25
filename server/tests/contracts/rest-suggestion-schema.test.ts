import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020Module, {
  type Ajv2020 as Ajv2020Instance,
  type ValidateFunction
} from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { restSuggestionSchema } from "../../src/domain/contracts.js";

const jsonSchema = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../contracts/schemas/rest-suggestion.schema.json"),
    "utf8"
  )
) as object;
const Ajv2020 = Ajv2020Module as unknown as {
  new (options?: Record<string, unknown>): Ajv2020Instance;
};
const validate = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false
}).compile(jsonSchema) as ValidateFunction;

const dynamicOffer = readFixture("rest-suggestion-generated-task.json");
const dynamicCompanion = readFixture(
  "rest-suggestion-companion-v1.1.json"
);
const legacyNoOffer = readFixture("rest-suggestion-no-offer.json");

describe("RestSuggestion Contract 1.1", () => {
  it("accepts an offer with a generated task", () => {
    expect(validate(dynamicOffer)).toBe(true);
    expect(restSuggestionSchema.safeParse(dynamicOffer).success).toBe(true);
  });

  it("accepts a companion message without a generated task", () => {
    expect(validate(dynamicCompanion)).toBe(true);
    expect(
      restSuggestionSchema.safeParse(dynamicCompanion).success
    ).toBe(true);
  });

  it("keeps the Contract 1.0 fixture valid", () => {
    expect(validate(legacyNoOffer)).toBe(true);
    expect(
      restSuggestionSchema.safeParse(legacyNoOffer).success
    ).toBe(true);
  });

  it.each([
    {
      name: "an offer without a generated task",
      suggestion: { ...dynamicOffer, generated_task: null }
    },
    {
      name: "a no-offer response with a generated task",
      suggestion: {
        ...dynamicCompanion,
        generated_task: dynamicOffer.generated_task
      }
    },
    {
      name: "a non-null default Quest in Contract 1.1",
      suggestion: { ...dynamicOffer, default_quest_id: "look-away-20" }
    }
  ])("rejects $name", ({ suggestion }) => {
    expect(validate(suggestion)).toBe(false);
    expect(restSuggestionSchema.safeParse(suggestion).success).toBe(false);
  });
});

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `../contracts/fixtures/${name}`),
      "utf8"
    )
  ) as Record<string, unknown>;
}
