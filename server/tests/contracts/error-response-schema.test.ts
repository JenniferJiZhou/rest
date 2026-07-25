import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020Module, {
  type Ajv2020 as Ajv2020Instance
} from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { errorResponseSchema } from "../../src/domain/contracts.js";

const schema = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../contracts/schemas/error-response.schema.json"),
    "utf8"
  )
) as object;
const fixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "../contracts/fixtures/error-rest-decision-unavailable-v1.1.json"
    ),
    "utf8"
  )
) as unknown;
const Ajv2020 = Ajv2020Module as unknown as {
  new (options?: Record<string, unknown>): Ajv2020Instance;
};
const validate = new Ajv2020({ strict: true }).compile(schema);

describe("ErrorResponse Contract 1.1", () => {
  it("keeps the existing error shape while reporting version 1.1", () => {
    expect(validate(fixture)).toBe(true);
    expect(errorResponseSchema.safeParse(fixture).success).toBe(true);
  });
});
