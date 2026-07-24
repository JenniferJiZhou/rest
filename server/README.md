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

`GET /v1/health` does not require client headers. All other W1 routes require:

```text
X-Request-ID
X-Client-Version
X-Contract-Version: 1.0
```

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
```

`test:contracts` validates fixtures and local OpenAPI references. The current
full suite contains 149 deterministic tests. W1-04
vertical-slice tests use real TCP/HTTP on a random `127.0.0.1` port and do not
expose a stable development port.

## Current provider behavior

- Without both `CLAUDE_API_KEY` and `CLAUDE_MODEL`, Agent calls use
  `CannedAgentLLM`. Canned output is Mock data; it is not real Claude output.
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
LLM_TIMEOUT_MS=15000
MAIL_FETCH_TIMEOUT_MS=10000
DRAFT_CREATE_TIMEOUT_MS=10000
COMPLETION_SEND_TIMEOUT_MS=5000
```

Each accepts an integer from 100 through 120000 milliseconds. Handoff
cancellation aborts the active Agent, Mail, Draft, or Completion call.
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
