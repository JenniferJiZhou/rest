import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import Ajv2020Module, {
  type Ajv2020 as Ajv2020Instance,
  type AnySchema,
  type ValidateFunction
} from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

export interface FixtureContract {
  fixture: string;
  schema: string;
  fragment?: string;
}

export const FIXTURE_CONTRACTS: FixtureContract[] = [
  {
    fixture: "usage-summary-manual-ios.json",
    schema: "usage-summary.schema.json"
  },
  {
    fixture: "usage-summary-device-activity-ios.json",
    schema: "usage-summary.schema.json"
  },
  {
    fixture: "usage-summary-macos-app.json",
    schema: "usage-summary.schema.json"
  },
  {
    fixture: "usage-summary-macos-website.json",
    schema: "usage-summary.schema.json"
  },
  {
    fixture: "rest-suggestion-no-offer.json",
    schema: "rest-suggestion.schema.json"
  },
  {
    fixture: "fatigue-check-in-cognitive.json",
    schema: "fatigue-check-in.schema.json"
  },
  {
    fixture: "fatigue-reflection-follow-up.json",
    schema: "fatigue-reflection.schema.json"
  },
  {
    fixture: "rest-quest-wash-face.json",
    schema: "rest-quest.schema.json"
  },
  {
    fixture: "rest-recommendation-success.json",
    schema: "rest-recommendation.schema.json",
    fragment: "/$defs/RestQuestRecommendation"
  },
  {
    fixture: "handoff-start-request.json",
    schema: "handoff-start-request.schema.json"
  },
  {
    fixture: "handoff-start-open-loops-no-gmail.json",
    schema: "handoff-start-request.schema.json"
  },
  {
    fixture: "handoff-job-running.json",
    schema: "handoff-job.schema.json",
    fragment: "/$defs/HandoffJobState"
  },
  {
    fixture: "handoff-job-failed-gmail.json",
    schema: "handoff-job.schema.json",
    fragment: "/$defs/HandoffJobState"
  },
  {
    fixture: "handoff-job-succeeded-open-loops-only.json",
    schema: "handoff-job.schema.json",
    fragment: "/$defs/HandoffJobState"
  },
  {
    fixture: "handoff-summary-success.json",
    schema: "handoff-summary.schema.json"
  },
  {
    fixture: "handoff-summary-open-loops-only.json",
    schema: "handoff-summary.schema.json"
  },
  {
    fixture: "error-llm-invalid-output.json",
    schema: "error-response.schema.json"
  },
  {
    fixture: "inbox-event-batch-demo.json",
    schema: "inbox-event-batch.schema.json"
  },
  {
    fixture: "inbox-item-enriched-demo.json",
    schema: "inbox-item.schema.json"
  },
  {
    fixture: "inbox-draft-edited-demo.json",
    schema: "inbox-draft.schema.json"
  }
];

export function createContractValidator(rootPath?: string): {
  validateFixture(contract: FixtureContract): {
    valid: boolean;
    errors: ValidateFunction["errors"];
  };
} {
  const repositoryRoot =
    rootPath ?? resolve(sourceDirectory, "../../..");
  const schemaDirectory = resolve(repositoryRoot, "contracts/schemas");
  const fixtureDirectory = resolve(repositoryRoot, "contracts/fixtures");
  const schemaBaseUrl = pathToFileURL(`${schemaDirectory}/`).href;
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

  for (const name of readdirSync(schemaDirectory).filter((file) =>
    file.endsWith(".json")
  )) {
    const schema = JSON.parse(
      readFileSync(resolve(schemaDirectory, name), "utf8")
    ) as AnySchema;
    ajv.addSchema(schema, new URL(name, schemaBaseUrl).href);
  }

  return {
    validateFixture(contract) {
      const schemaUrl = new URL(contract.schema, schemaBaseUrl).href;
      const key = contract.fragment
        ? `${schemaUrl}#${contract.fragment}`
        : schemaUrl;
      const validate = ajv.getSchema(key);
      if (!validate) {
        throw new Error(`Schema was not registered: ${key}`);
      }
      const fixture = JSON.parse(
        readFileSync(resolve(fixtureDirectory, contract.fixture), "utf8")
      ) as unknown;
      const validationResult = validate(fixture);
      if (typeof validationResult !== "boolean") {
        throw new Error("Async JSON Schema validation is not supported.");
      }
      return {
        valid: validationResult,
        errors: validate.errors
      };
    }
  };
}
