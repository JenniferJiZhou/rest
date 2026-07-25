# Hush Server

W1/P2 maintains the existing Rest and Handoff backend. W2/P3 owns Unified
Inbox end to end: contracts, API, storage, AI orchestration, Connector Host,
provider adapters, confirmed send flow, and its Composition Root wiring.

Business routes call application services. They never call provider CLIs,
Graph, IMAP/SMTP, or AI SDKs directly.

## Toolchain

- Node.js >=20.19 <21
- pnpm 9.x
- TypeScript 5.9
- Fastify 5
- Zod 4
- Vitest 3

The package deliberately rejects unsupported major Node/pnpm versions through
`engines`. Local commands can still be inspected on newer Node versions, but
the demo, CI, and deployment environment must use Node 20.19+ within the
20.x line. `.nvmrc` and `.node-version` pin the certified patch.

## Start

From the repository root, copy `.env.example` to `.env`, then:

```powershell
cd server
corepack pnpm install
corepack pnpm dev
```

The server listens on `HOST` and `PORT`. Safe defaults are
`127.0.0.1:3000`, which are reachable only from the same machine. For an
explicit trusted-LAN Apple integration session, set `HOST=0.0.0.0` and use
the Windows machine's LAN IPv4 address from the Apple device. See
`../docs/15_APPLE_MOCK_INTEGRATION_RELEASE.md`.

`PUBLIC_BASE_URL` is currently validated and reserved for future OAuth or
external callback URL construction; the existing W1 routes do not use it to
change listener or response behavior.

`GET /v1/health` does not require client headers or call any Provider. It is
a lightweight process liveness endpoint and exposes only provider-neutral
configuration readiness. All other W1 routes require:

```text
X-Request-ID
X-Client-Version
X-Contract-Version: 1.0
```

`POST /v1/rest/evaluate` and `POST /v1/rest/recommend` additionally accept
`X-Contract-Version: 1.1`. Every other route remains 1.0-only.

The body `request_id` must equal `X-Request-ID`. Mutating idempotent routes also
require an `Idempotency-Key` of 8–128 Unicode characters after trimming, with
no control characters.

Unified Inbox exposes:

```text
POST /v1/inbox/events:batch
GET  /v1/inbox/items
GET  /v1/inbox/items/{itemId}
POST /v1/inbox/items/{itemId}/summary
POST /v1/inbox/items/{itemId}/draft
GET/PATCH /v1/inbox/drafts/{draftId}
POST /v1/inbox/drafts/{draftId}/confirmation
POST /v1/inbox/drafts/{draftId}:send
GET  /v1/inbox/sync-status
```

Sending requires the current draft version, an unconsumed five-minute
confirmation token bound to the authenticated App session, and
`Idempotency-Key`. AI providers receive message text but never provider
credentials, confirmation tokens, or a send tool.

Normal Inbox routes require `Authorization: Bearer <HUSH_APP_TOKEN>` plus a
32–128 character, per-launch high-entropy `X-Hush-App-Session`; confirmation
tokens are bound to the authenticated digest of both values.
`POST /v1/inbox/events:batch` instead requires
`Authorization: Bearer <HUSH_CONNECTOR_TOKEN>`; the two credentials are not
interchangeable and configuration rejects equal values. Both values must
contain at least 32 characters and are mandatory in production. Sample Mode
may use `X-Hush-Demo-Token` and always selects the isolated Fixture graph;
its App routes still require `X-Hush-App-Session`.

## Commands

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
corepack pnpm test:providers
corepack pnpm test:integration
corepack pnpm test:vertical
corepack pnpm test:deployment
```

`test:contracts` validates fixtures and local OpenAPI references. Vertical
slice tests include the credential-free Unified Inbox flow, and the full
suite is deterministic. W1-04
vertical-slice tests use real TCP/HTTP on a random `127.0.0.1` port and do not
expose a stable development port.

## Current provider behavior

- Without both `CLAUDE_API_KEY` and `CLAUDE_MODEL`, Agent calls use
  `CannedAgentLLM`. Canned output is Mock data; it is not real Claude output.
- `HUSH_REST_DECISION_PROVIDER` independently selects `real`, `canned`, or
  `unavailable` for Contract 1.1 `POST /v1/rest/evaluate` and
  `POST /v1/rest/recommend`. Contract 1.0 Real uses the legacy
  Claude/fixed-Quest configuration. Contract 1.1 Real uses
  `STEPFUN_API_KEY`, `STEPFUN_BASE_URL`, explicit `STEPFUN_MODEL`, and
  `STEPFUN_TIMEOUT_MS`. Incomplete Real configuration selects the explicit
  Unavailable Provider; it never silently falls back to Canned.
- Demo Rest Decision always uses its own Canned Provider and never calls the
  model API. A successful Real Rest Decision response is marked
  `X-Hush-Data-Origin: real`; Canned and Demo responses are `mock`.
- Until Gmail Owner supplies a Gmail adapter, the real Handoff path completes with
  user-submitted open loops only and explicitly marks Gmail as unavailable.
- A valid demo token switches to fixture mail and canned Agent behavior.
- A valid demo token also switches Unified Inbox to independent Fixture
  intelligence, repositories, confirmation store, idempotency store, and
  senders for Feishu, DingTalk, Outlook, and QQ Mail.
- Without provider configuration, normal Unified Inbox adapters report
  `unavailable`. Configured adapters are `lark-cli`, DingTalk `dws`,
  Microsoft Graph, and QQ IMAP/SMTP.
- Real provider credentials have not been exercised by CI. Tenant/admin
  approval and account-specific smoke tests remain required.
- `X-Hush-Data-Origin` is computed from the complete selected dependency
  graph. A normal graph containing Canned, Fixture, Recording, Noop, or
  Console providers is conservatively marked `mock`; it is `real` only when
  every participating provider declares a real origin.
- Demo Rest/Handoff uses independent Agent, Mail, repositories, and
  Completion Sink instances. A real messaging override is never routed into
  the Demo graph.

## Reliability boundaries

Provider calls are bounded by validated environment settings:

```text
REST_DECISION_TIMEOUT_MS=3500        # Contract 1.0 legacy
STEPFUN_TIMEOUT_MS=30000             # Contract 1.1 transport
LLM_TIMEOUT_MS=15000
MAIL_FETCH_TIMEOUT_MS=10000
DRAFT_CREATE_TIMEOUT_MS=10000
COMPLETION_SEND_TIMEOUT_MS=5000
INBOX_POLL_INTERVAL_MS=30000
```

Legacy Rest Decision accepts 500–4500 milliseconds. StepFun accepts
500–120000 milliseconds and defaults to 30000. The other timeouts accept an
integer from 100 through 120000 milliseconds.
`INBOX_POLL_INTERVAL_MS` accepts 1000 through 3600000 milliseconds. Handoff
cancellation aborts the active Agent, Mail, Draft, or Completion call.
Rest Decision timeout and HTTP client disconnect also abort the active model
call. Timeout, unavailable infrastructure, and invalid model output return
HTTP 503 and are not cached as successful decisions.
Completion notification is an auxiliary delivery: failure or timeout is
logged by correlation ID but does not reverse an already persisted
`succeeded` Job. A failed draft remains in `drafts` with `saved=false` and in
the Pause Receipt as `held_items:not_saved`.

Jobs and idempotency claims remain process-local. Unified Inbox items,
drafts, checkpoints, confirmation tokens, and send idempotency claims are
also process-local in this Demo implementation; restarting the server loses
them. The repository and checkpoint ports are the boundary for a durable
production implementation.

New Handoff starts run a
five-minute-throttled opportunistic cleanup of expired terminal Jobs and
claims; running Jobs are never deleted. Restarting the server loses all Job
IDs and in-memory claims.

## CI

`.github/workflows/server-ci.yml` pins Node 20.19.5 and pnpm 9.15.9, installs
with `--frozen-lockfile`, and runs typecheck, provider contracts, integration,
vertical slice, full tests, production build, diff checks, and workspace
cleanliness checks without real provider credentials.

## HTTPS staging and containers

Production HTTPS terminates at the cloud platform; Fastify receives internal
HTTP. Set `TRUST_PROXY=true` only behind that trusted proxy. Production also
requires an explicit public HTTPS `PUBLIC_BASE_URL`. Local defaults remain
loopback-only with proxy trust disabled.

The repository-root `Dockerfile` preserves runtime access to
`content/rest-quests.json` and the Demo inbox fixtures. GitHub Actions builds
an immutable GHCR image for a Zeabur Docker Image service. See
`../docs/18_ZEABUR_STAGING_DEPLOYMENT.md`. No cloud resource or certificate is
created by the checked-in files.

## Unified Inbox integration points

Provider-neutral interfaces live in `src/inbox/ports.ts`. Implementations and
vendor payloads stay under `src/inbox/providers/`; application and route code
must not import provider SDK or CLI types.

```text
LARK_CLI_PATH / LARK_ACCOUNT_ID
DWS_CLI_PATH / DINGTALK_ACCOUNT_ID
OUTLOOK_ACCOUNT_ID / OUTLOOK_ACCESS_TOKEN
QQ_EMAIL_ADDRESS / QQ_EMAIL_AUTH_CODE
```

Empty values mean unconfigured. Secrets are resolved only inside adapters and
are redacted from HTTP errors and logs. QQ SMTP and Graph timeouts return
`unknown`; they are not retried automatically.

Gmail-specific code stays under `src/mail/`; Photon code stays under
`src/messaging/`. Each Owner exports factories or registration functions. W1
wires those exports in `src/composition.ts` after review.

The Gmail adapter must honor `DraftRequest.dedupeKey`. It must never send mail;
`createDraft` only creates or returns an existing draft.

## Real Rest Decision

Contract 1.0 uses the versioned `rest-decision-v1.0` System Prompt,
Anthropic structured output, fixed reason/Quest allowlists, and the legacy
Output Guard.

Contract 1.1 uses the independent `dynamic-rest-decision-v1.1` Mode A Prompt
and `dynamic-manual-rest-v1.1` Mode B Prompt with StepFun Chat Completions
JSON mode. The selected Router schema is serialized into the system message
with exact camelCase instructions; the server still parses and validates the
mode-specific result. It does not send allowed Quest IDs, read the Quest
Repository, apply the 15-minute cooldown bypass, or use the 3500 ms legacy
deadline. Mode C does not generate a rest task, and Sleep Handoff is outside
this path. The server injects actions and always returns
`default_quest_id=null`. Neither version gives the model tools or control
over Shield, notifications, Lockdown, request IDs, checkpoints, email, or
messages.

See `../docs/19_REAL_REST_DECISION_AGENT.md` for Contract 1.0 and
`../docs/22_DYNAMIC_REST_TASK_CONTRACT_1_1.md` for Contract 1.1.

The W2 Unified Inbox API, isolated Demo graph, provider adapters, and
credential-gated real validation are documented in
`../docs/unified-inbox-apple-frontend-handoff.md` and
`../docs/feishu-dingtalk-real-validation/README.md`.
