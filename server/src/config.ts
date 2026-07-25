import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: resolve(sourceDirectory, "../../.env"), quiet: true });

const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.string().trim().min(1).optional()
);

const optionalToken = (minimumLength: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : value,
    z.string().min(minimumLength).optional()
  );

const environmentSchema = z
  .object({
    HOST: z.string().trim().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    NODE_ENV: z
      .enum(["development", "test", "demo", "production"])
      .default("development"),
    PUBLIC_BASE_URL: z.url(),
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    HUSH_REST_DECISION_PROVIDER: z
      .enum(["canned", "unavailable"])
      .default("canned"),
    CLAUDE_API_KEY: z.string().min(1).optional(),
    CLAUDE_MODEL: z.string().min(1).optional(),
    LLM_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(120_000)
      .default(15_000),
    MAIL_FETCH_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(120_000)
      .default(10_000),
    DRAFT_CREATE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(120_000)
      .default(10_000),
    COMPLETION_SEND_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(120_000)
      .default(5_000),
    INBOX_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(30_000),
    INBOX_STEPFUN_BASE_URL: z
      .url()
      .default("https://api.stepfun.com/step_plan/v1"),
    INBOX_STEPFUN_MODEL: z
      .string()
      .trim()
      .min(1)
      .default("step-3.7-flash"),
    INBOX_STEPFUN_API_KEY: optionalString,
    INBOX_INITIAL_LOOKBACK_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(60),
    INBOX_SYNC_BATCH_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(100),
    INBOX_STATE_FILE: z
      .string()
      .trim()
      .min(1)
      .default(".data/unified-inbox-state.json"),
    LARK_CLI_PATH: optionalString,
    LARK_ACCOUNT_ID: optionalString,
    DWS_CLI_PATH: optionalString,
    DINGTALK_ACCOUNT_ID: optionalString,
    OUTLOOK_ACCOUNT_ID: optionalString,
    OUTLOOK_ACCESS_TOKEN: optionalString,
    QQ_EMAIL_ADDRESS: optionalString,
    QQ_EMAIL_AUTH_CODE: optionalString,
    HUSH_DEMO_MODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    HUSH_DEMO_TOKEN: optionalToken(8),
    HUSH_APP_TOKEN: optionalToken(32),
    HUSH_CONNECTOR_TOKEN: optionalToken(32),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info")
  })
  .passthrough();

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): AppConfig {
  const environmentWithLocalDefaults = {
    ...environment,
    ...((environment.NODE_ENV ?? "development") !== "production" &&
    environment.PUBLIC_BASE_URL === undefined
      ? { PUBLIC_BASE_URL: "http://localhost:3000" }
      : {})
  };
  const result = environmentSchema.safeParse(environmentWithLocalDefaults);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  if (result.data.HUSH_DEMO_MODE && !result.data.HUSH_DEMO_TOKEN) {
    throw new Error(
      "Invalid server configuration: HUSH_DEMO_TOKEN is required when HUSH_DEMO_MODE=true"
    );
  }
  if (
    result.data.NODE_ENV === "production" &&
    (!result.data.HUSH_APP_TOKEN ||
      !result.data.HUSH_CONNECTOR_TOKEN)
  ) {
    throw new Error(
      "Invalid server configuration: HUSH_APP_TOKEN and HUSH_CONNECTOR_TOKEN are required in production"
    );
  }
  if (
    result.data.HUSH_APP_TOKEN &&
    result.data.HUSH_CONNECTOR_TOKEN &&
    result.data.HUSH_APP_TOKEN === result.data.HUSH_CONNECTOR_TOKEN
  ) {
    throw new Error(
      "Invalid server configuration: HUSH_APP_TOKEN and HUSH_CONNECTOR_TOKEN must be different"
    );
  }
  result.data.PUBLIC_BASE_URL = validateAndNormalizePublicBaseUrl(
    result.data.PUBLIC_BASE_URL,
    result.data.NODE_ENV
  );
  return result.data;
}

function validateAndNormalizePublicBaseUrl(
  value: string,
  nodeEnvironment: AppConfig["NODE_ENV"]
): string {
  const url = new URL(value);
  if (
    nodeEnvironment === "production" &&
    (url.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      url.username.length > 0 ||
      url.password.length > 0)
  ) {
    throw new Error(
      "Invalid server configuration: PUBLIC_BASE_URL must be a public HTTPS URL without credentials, query, or fragment in production"
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}
