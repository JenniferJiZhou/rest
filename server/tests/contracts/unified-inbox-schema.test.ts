import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020Module, {
  type Ajv2020 as Ajv2020Instance,
  type AnySchema,
  type ValidateFunction
} from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "../contracts/schemas/unified-inbox.schema.json"
    ),
    "utf8"
  )
) as AnySchema & { $id: string };
const fixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "../contracts/fixtures/unified-inbox-items.json"
    ),
    "utf8"
  )
) as {
  items: Array<Record<string, unknown>>;
};
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
ajv.addSchema(schema);

describe("Unified Inbox JSON Schema", () => {
  it("accepts exactly the four provider-neutral sources", () => {
    const validate = definition("Source");
    for (const source of ["feishu", "dingtalk", "outlook", "qq_mail"]) {
      expect(validate(source), JSON.stringify(validate.errors)).toBe(true);
    }
    expect(validate("gmail")).toBe(false);
  });

  it("keeps unknown priority explicit and item status bounded", () => {
    const priority = definition("Priority");
    const status = definition("ItemStatus");

    expect(priority("uncertain")).toBe(true);
    expect(priority("urgent")).toBe(false);
    expect(status("acknowledged")).toBe(true);
    expect(status("archived")).toBe(false);
  });

  it("rejects extra provider fields and attachment locations", () => {
    const validate = definition("ItemDetail");
    const item: Record<string, unknown> = {
      ...structuredClone(fixture.items[0]),
      body: "Synthetic detail.",
      participants: [],
      attachments: [],
      provider_capabilities: {
        can_acknowledge: true,
        can_draft_reply: true,
        can_send_reply: true,
        supports_attachments: false
      },
      acknowledged_at: null,
      provider_private_payload: { token: "must-not-pass" }
    };
    expect(validate(item)).toBe(false);

    delete item.provider_private_payload;
    item.attachments = [
      {
        id: "attachment_mock",
        file_name: "mock.txt",
        media_type: "text/plain",
        size_bytes: 10,
        local_path: "C:/private/mock.txt"
      }
    ];
    expect(validate(item)).toBe(false);
  });

  it("accepts only discriminated draft mutations with safe body text", () => {
    const validate = definition("PatchDraftRequest");
    const base = {
      schema_version: "1.0",
      request_id: "req_schema_patch",
      operation: "update_body",
      expected_version: 1,
      body: "A safe synthetic reply."
    };

    expect(validate(base)).toBe(true);
    expect(validate({ ...base, unexpected: true })).toBe(false);
    expect(validate({ ...base, body: "   " })).toBe(false);
    expect(validate({ ...base, body: `unsafe\u0000body` })).toBe(false);
    expect(validate({ ...base, body: "x".repeat(10_001) })).toBe(false);
    expect(
      validate({
        schema_version: "1.0",
        request_id: "req_schema_discard",
        operation: "discard",
        expected_version: 1
      })
    ).toBe(true);
    expect(
      validate({
        schema_version: "1.0",
        request_id: "req_schema_discard_body",
        operation: "discard",
        expected_version: 1,
        body: "ambiguous"
      })
    ).toBe(false);
  });
});

function definition(name: string): ValidateFunction {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!validate) {
    throw new Error(`missing Unified Inbox definition: ${name}`);
  }
  return validate;
}
