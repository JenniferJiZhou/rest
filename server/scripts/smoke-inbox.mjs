import { randomUUID } from "node:crypto";

const providers = new Set(["feishu", "dingtalk"]);
const stages = new Set([
  "arguments",
  "guard",
  "config",
  "sync_status",
  "items",
  "item",
  "draft",
  "confirmation",
  "send"
]);
const errorCodePattern = /^[A-Z][A-Z0-9_]{0,80}$/;
const publicIdKeys = new Set(["id", "draft_id", "target_id"]);

class SmokeFailure extends Error {
  constructor(stage, status, code) {
    super(code);
    this.stage = stage;
    this.status = status;
    this.code = code;
  }
}

async function main() {
  const input = parseArguments(process.argv.slice(2));
  const provider = input.provider;
  const baseUrl = requiredBaseUrl();
  const appToken = requiredEnvironment("HUSH_APP_TOKEN");
  const session = randomUUID();
  const request = createRequest(baseUrl, appToken, session);

  if (input.mode === "send") {
    if (process.env.HUSH_SMOKE_ALLOW_SEND !== "true") {
      throw new SmokeFailure("guard", 0, "HUSH_SMOKE_SEND_DISABLED");
    }
    await sendDraft(request, provider, input.itemId);
    pass(
      provider,
      "send",
      "sent=true confirmation=true idempotency_fresh=true"
    );
    return;
  }

  await validateRead(request, provider);
}

function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !["--provider", "--mode", "--item-id"].includes(name) ||
      value === undefined ||
      values.has(name)
    ) {
      throw new SmokeFailure("arguments", 0, "HUSH_SMOKE_ARGUMENTS_INVALID");
    }
    values.set(name, value);
  }
  const provider = values.get("--provider");
  if (!providers.has(provider)) {
    throw new SmokeFailure("arguments", 0, "HUSH_SMOKE_PROVIDER_INVALID");
  }
  const mode = values.get("--mode");
  if (mode !== "read" && mode !== "send") {
    throw new SmokeFailure("arguments", 0, "HUSH_SMOKE_MODE_INVALID");
  }
  const itemId = values.get("--item-id");
  if (mode === "send" && (!itemId || !itemId.trim())) {
    throw new SmokeFailure("arguments", 0, "HUSH_SMOKE_ITEM_ID_REQUIRED");
  }
  if (mode === "read" && itemId !== undefined) {
    throw new SmokeFailure("arguments", 0, "HUSH_SMOKE_ITEM_ID_UNEXPECTED");
  }
  if (
    itemId &&
    itemId.split(/[\\/]/).some((segment) => segment === "." || segment === "..")
  ) {
    throw new SmokeFailure("arguments", 0, "HUSH_SMOKE_ITEM_ID_INVALID");
  }
  return { provider, mode, itemId };
}

function requiredBaseUrl() {
  const value = requiredEnvironment("HUSH_BASE_URL");
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("unsupported protocol");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new SmokeFailure("config", 0, "HUSH_SMOKE_BASE_URL_INVALID");
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new SmokeFailure("config", 0, "HUSH_SMOKE_CONFIG_INVALID");
  }
  return value;
}

function createRequest(baseUrl, appToken, session) {
  return async (stage, path, options = {}, requestId = randomUUID()) => {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          authorization: `Bearer ${appToken}`,
          "x-request-id": requestId,
          "x-client-version": "hush-inbox-smoke",
          "x-contract-version": "1.0",
          "x-hush-app-session": session,
          ...(options.headers ?? {})
        }
      });
    } catch {
      throw new SmokeFailure(stage, 0, "HUSH_SMOKE_NETWORK_ERROR");
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new SmokeFailure(stage, response.status, "HUSH_SMOKE_RESPONSE_INVALID");
    }
    if (!response.ok) {
      throw new SmokeFailure(stage, response.status, hushErrorCode(body));
    }
    return body;
  };
}

async function validateRead(request, provider) {
  const syncStatus = await request("sync_status", "/v1/inbox/sync-status");
  if (
    !Array.isArray(syncStatus) ||
    !syncStatus.some((entry) => validReadySync(entry, provider))
  ) {
    throw new SmokeFailure("sync_status", 0, "HUSH_SMOKE_SYNC_NOT_READY");
  }

  const listed = await request("items", "/v1/inbox/items?limit=100");
  if (!isRecord(listed) || !Array.isArray(listed.items)) {
    throw new SmokeFailure("items", 0, "HUSH_SMOKE_RESPONSE_INVALID");
  }
  const cards = listed.items.filter(
    (item) => isRecord(item) && item.provider === provider
  );
  if (cards.length === 0) {
    throw new SmokeFailure("items", 0, "HUSH_SMOKE_PROVIDER_CARD_MISSING");
  }
  for (const card of cards) {
    if (containsPrivateIdKey(card)) {
      throw new SmokeFailure("items", 0, "HUSH_SMOKE_PRIVATE_ID_FIELD");
    }
    if (!validPublicCard(card)) {
      throw new SmokeFailure("items", 0, "HUSH_SMOKE_CARD_INVALID");
    }
  }

  pass(
    provider,
    "read",
    [
      `card_count=${cards.length}`,
      "sync_ready=true",
      "conversation_metadata=true",
      "stepfun_summary=true",
      `needs_reply=${cards.some((card) => card.needs_reply)}`,
      `draft_present=${cards.every(
        (card) => !card.needs_reply || typeof card.draft_id === "string"
      )}`,
      "private_id_fields=false"
    ].join(" ")
  );
}

async function sendDraft(request, provider, itemId) {
  const item = await request(
    "item",
    `/v1/inbox/items/${encodeURIComponent(itemId)}`
  );
  if (!isRecord(item) || item.provider !== provider || item.id !== itemId) {
    throw new SmokeFailure("item", 0, "HUSH_SMOKE_PROVIDER_MISMATCH");
  }
  if (typeof item.draft_id !== "string" || !item.draft_id.trim()) {
    throw new SmokeFailure("item", 0, "HUSH_SMOKE_DRAFT_MISSING");
  }
  const draftId = item.draft_id;
  const draft = await request(
    "draft",
    `/v1/inbox/drafts/${encodeURIComponent(draftId)}`
  );
  if (
    !isRecord(draft) ||
    draft.id !== draftId ||
    draft.inbox_item_id !== itemId ||
    !Number.isInteger(draft.version) ||
    draft.version < 1
  ) {
    throw new SmokeFailure("draft", 0, "HUSH_SMOKE_DRAFT_VERSION_INVALID");
  }
  const confirmationRequestId = randomUUID();
  const confirmation = await request(
    "confirmation",
    `/v1/inbox/drafts/${encodeURIComponent(draftId)}/confirmation`,
    { method: "POST" },
    confirmationRequestId
  );
  if (
    !isRecord(confirmation) ||
    typeof confirmation.confirmation_token !== "string" ||
    !confirmation.confirmation_token.trim() ||
    confirmation.confirmation_token.length < 16 ||
    !futureIsoDate(confirmation.expires_at)
  ) {
    throw new SmokeFailure("confirmation", 0, "HUSH_SMOKE_CONFIRMATION_INVALID");
  }
  const sendRequestId = randomUUID();
  const sent = await request(
    "send",
    `/v1/inbox/drafts/${encodeURIComponent(draftId)}:send`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID()
      },
      body: JSON.stringify({
        schema_version: "1.0",
        request_id: sendRequestId,
        expected_version: draft.version,
        confirmation_token: confirmation.confirmation_token
      })
    },
    sendRequestId
  );
  if (
    !isRecord(sent) ||
    sent.draft_id !== draftId ||
    sent.provider !== provider ||
    sent.status !== "sent" ||
    !nullableNonEmptyString(sent.provider_message_id) ||
    !nullableIsoDate(sent.sent_at)
  ) {
    throw new SmokeFailure("send", 0, "HUSH_SMOKE_SEND_NOT_CONFIRMED");
  }
}

function validReadySync(entry, provider) {
  return (
    isRecord(entry) &&
    entry.provider === provider &&
    entry.status === "ready" &&
    typeof entry.account_id === "string" &&
    Boolean(entry.account_id.trim()) &&
    nullableNonEmptyString(entry.checkpoint) &&
    nullableIsoDate(entry.last_synced_at) &&
    nullableNonEmptyString(entry.last_error) &&
    validCoverage(entry.coverage)
  );
}

function validPublicCard(card) {
  return (
    isRecord(card) &&
    nonEmptyString(card.id) &&
    (card.item_kind === "message" || card.item_kind === "conversation_digest") &&
    (card.conversation_type === "direct" || card.conversation_type === "group") &&
    nonEmptyString(card.conversation_name) &&
    Number.isInteger(card.revision) && card.revision >= 1 &&
    Number.isInteger(card.message_count) && card.message_count >= 1 &&
    isoDate(card.window_started_at) && isoDate(card.window_ended_at) &&
    Date.parse(card.window_started_at) <= Date.parse(card.window_ended_at) &&
    nonEmptyString(card.summary) &&
    stringArray(card.important_points) &&
    stringArray(card.todos) &&
    ["urgent", "normal", "low", "uncertain"].includes(card.priority) &&
    typeof card.needs_reply === "boolean" &&
    validReplyTargets(card.reply_targets) &&
    (card.draft_id === null || nonEmptyString(card.draft_id)) &&
    ["pending", "ready", "failed"].includes(card.sync_status) &&
    (!card.needs_reply || nonEmptyString(card.draft_id))
  );
}

function validCoverage(value) {
  return isRecord(value) &&
    ["official_api", "imap", "browser_fallback"].includes(value.source) &&
    typeof value.complete === "boolean" &&
    nullableNonEmptyString(value.note);
}

function validReplyTargets(value) {
  return Array.isArray(value) && value.every((target) =>
    isRecord(target) &&
    typeof target.target_id === "string" && /^participant_[a-zA-Z0-9_-]{8,64}$/.test(target.target_id) &&
    nonEmptyString(target.display_name) && nonEmptyString(target.reason)
  );
}

function containsPrivateIdKey(value) {
  if (Array.isArray(value)) return value.some(containsPrivateIdKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) =>
    privateIdKey(key) ||
    containsPrivateIdKey(nested)
  );
}

function privateIdKey(key) {
  const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return normalized === "sender_ref" ||
    (normalized.endsWith("_id") && !publicIdKeys.has(normalized));
}

function stringArray(value) {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function nonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function nullableNonEmptyString(value) {
  return value === null || nonEmptyString(value);
}

function isoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nullableIsoDate(value) {
  return value === null || isoDate(value);
}

function futureIsoDate(value) {
  return isoDate(value) && Date.parse(value) > Date.now();
}

function hushErrorCode(body) {
  const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
  return typeof code === "string" && errorCodePattern.test(code)
    ? code
    : "HUSH_HTTP_ERROR";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pass(provider, stage, details) {
  process.stdout.write(`PASS provider=${provider} stage=${stage} ${details}\n`);
}

function fail(provider, error) {
  const stage = error instanceof SmokeFailure && stages.has(error.stage)
    ? error.stage
    : "config";
  const status = error instanceof SmokeFailure && Number.isInteger(error.status)
    ? error.status
    : 0;
  const code = error instanceof SmokeFailure && errorCodePattern.test(error.code)
    ? error.code
    : "HUSH_SMOKE_UNEXPECTED_FAILURE";
  process.stderr.write(
    `FAIL provider=${provider} stage=${stage} status=${status} error_code=${code}\n`
  );
}

const providerArgument = process.argv.includes("--provider")
  ? process.argv[process.argv.indexOf("--provider") + 1]
  : "unknown";
const outputProvider = providers.has(providerArgument) ? providerArgument : "unknown";

main().catch((error) => {
  fail(outputProvider, error);
  process.exitCode = 1;
});
