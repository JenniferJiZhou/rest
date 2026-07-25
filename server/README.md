# Hush Server

W1/P2 owns the API boundary, Agent orchestration, Rest application service,
Handoff Job state machine, contracts implementation, bootstrap, and provider
ports and the final Composition Root. Gmail Owner owns only Gmail/OAuth
adapters. W2/P3 owns only Photon messaging and webhook adapters.

Business routes call application services. They never call Gmail, Photon, or
Claude SDKs directly.

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

`POST /v1/rest/evaluate` additionally accepts `X-Contract-Version: 1.1`.
Every other route remains 1.0-only.

The body `request_id` must equal `X-Request-ID`. Mutating idempotent routes also
require an `Idempotency-Key` of 8–128 Unicode characters after trimming, with
no control characters.

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

`test:contracts` validates fixtures and local OpenAPI references. The
full suite is deterministic. W1-04
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
```

Legacy Rest Decision accepts 500–4500 milliseconds. StepFun accepts
500–120000 milliseconds and defaults to 30000. The other timeouts accept an
integer from 100 through 120000 milliseconds. Handoff
cancellation aborts the active Agent, Mail, Draft, or Completion call.
Rest Decision timeout and HTTP client disconnect also abort the active model
call. Timeout, unavailable infrastructure, and invalid model output return
HTTP 503 and are not cached as successful decisions.
Completion notification is an auxiliary delivery: failure or timeout is
logged by correlation ID but does not reverse an already persisted
`succeeded` Job. A failed draft remains in `drafts` with `saved=false` and in
the Pause Receipt as `held_items:not_saved`.

Jobs and idempotency claims remain process-local. New Handoff starts run a
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

## Provider integration points

Provider Owners implement W1-owned interfaces from `src/domain/ports.ts`
without modifying that file:

- Gmail Owner implements `MailProvider`: Gmail health, unread fetch, and
  idempotent draft creation.
- W2 implements `MessagingChannel`, inbound mapping, and Photon-backed
  completion delivery.

Gmail-specific code stays under `src/mail/`; Photon code stays under
`src/messaging/`. Each Owner exports factories or registration functions. W1
wires those exports in `src/composition.ts` after review.

The Gmail adapter must honor `DraftRequest.dedupeKey`. It must never send mail;
`createDraft` only creates or returns an existing draft.

## Real Rest Decision

Contract 1.0 uses the versioned `rest-decision-v1.0` System Prompt,
Anthropic structured output, fixed reason/Quest allowlists, and the legacy
Output Guard.

Contract 1.1 uses the independent `dynamic-rest-decision-v1.1` Prompt,
StepFun Responses API strict JSON Schema, and a provider-neutral dynamic
execution path. It does not send allowed Quest IDs, read the Quest Repository,
apply the 15-minute cooldown bypass, or use the 3500 ms legacy deadline.
The server injects actions and always returns `default_quest_id=null`.
Neither version gives the model tools or control over Shield, notifications,
request IDs, or checkpoints.

See `../docs/19_REAL_REST_DECISION_AGENT.md` for Contract 1.0 and
`../docs/22_DYNAMIC_REST_TASK_CONTRACT_1_1.md` for Contract 1.1.

## Unified Inbox Mock Vertical Slice

Seven `/v1/inbox/**` operations implement provider-neutral list/detail,
acknowledge, draft CAS updates/discard, short-lived confirmation, and send.
Normal defaults to `HUSH_UNIFIED_INBOX_PROVIDER=unavailable`; explicit
`canned` and the isolated Demo graph use fixed fixtures. Canned send returns
`delivery_mode=simulated` with `X-Hush-Data-Origin: mock` and never contacts
Feishu, DingTalk, Outlook, or QQ Mail.

Drafts, confirmations, idempotency claims, and atomic send claims are
process-local. Restart and multiple instances do not preserve or share this
state. Swift mapping and the remaining real-integration work are documented
in `../docs/21_UNIFIED_INBOX_CONTRACT_AND_SWIFT_MAPPING.md`.

Local smoke defaults to read/edit/confirm without send:

```powershell
..\scripts\smoke-unified-inbox.ps1 `
  -BaseUrl "http://127.0.0.1:3000" `
  -Mode LocalHttp
```

Only a controlled mock environment may add `-AllowSimulatedSend`.
