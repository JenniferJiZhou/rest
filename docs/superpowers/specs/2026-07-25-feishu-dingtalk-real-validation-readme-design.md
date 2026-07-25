# Feishu and DingTalk Real Demo Documentation Design

## Goal

Create two focused documents for the competition Demo:

```text
docs/feishu-dingtalk-real-validation/README.md
docs/unified-inbox-apple-frontend-handoff.md
```

The validation README must let a competition teammate prepare a macOS Demo
host, authorize one real Feishu or DingTalk account, run a non-sending backend
validation, connect macOS and iOS Hush builds to that backend, and perform one
guarded send only after reviewing the draft in an API-connected Hush UI.

The frontend handoff must tell the Apple frontend Agent exactly how to replace
the current Fixture Unified Inbox data source with the existing backend API
without exposing provider credentials or weakening the send-confirmation
boundary.

The root `README.md` and the shorter
`docs/unified-inbox-external-validation.md` will link to both documents.

## Demo Topology

Windows is not required for the competition Demo. The supported topology is:

```text
real Feishu or DingTalk account
-> official CLI on the macOS Demo host
-> Hush Fastify server and Connector on the same Mac
-> StepFun and Unified Inbox API
-> macOS Hush App over loopback
-> iOS Hush App over a trusted local network
```

The macOS App uses the local server. The iOS App uses the Mac's LAN IPv4
address. LAN mode must bind the server deliberately, restrict firewall access
to the trusted Demo network, and must never expose the local Demo server to the
public internet.

The repository's current Apple Unified Inbox UI is Fixture-only. It explicitly
does not connect to real channels and does not perform real sends. Backend read
smoke can validate the real CLI-to-API path before frontend integration, but UI
acknowledgement, draft editing, and guarded send cannot pass until an
API-connected Apple build is available.

## Document One: Real Validation README

### Audience And Assumptions

The primary reader is a Demo operator who may not know the server internals.
The operator has:

- a macOS computer used as the Demo host;
- an iPhone or iOS simulator when the iOS presentation path is required;
- permission to complete browser or device-code authorization;
- an organization administrator available when DingTalk CLI access requires
  approval;
- a local checkout of this feature branch;
- Node.js 20.19.x and pnpm 9.15.9 through Corepack;
- a valid StepFun API key stored only in the local `.env`;
- an API-connected Hush build for UI and send validation.

The runbook will not assume Outlook or QQ Mail is configured. Those providers
must not block the Feishu or DingTalk Demo. CI, fixtures, and mocks cannot prove
that real provider authorization or the real end-to-end path works.

### Structure

The detailed README will use this execution order:

1. Scope, success criteria, current Fixture limitation, and non-goals.
2. Security rules and values that must never be committed or pasted into issue
   trackers.
3. Pinned official CLI versions and integrity verification.
4. One-time macOS machine preparation.
5. Local Hush `.env` configuration and sensitive state-file handling.
6. Feishu installation, exact scopes, login, one-time token verification, and
   provider-specific preflight.
7. DingTalk installation, organization CLI approval, login, profile selection,
   and provider-specific preflight.
8. Hush server startup for loopback macOS use and controlled trusted-LAN iOS
   use.
9. Read-only backend smoke and expected sanitized output.
10. Conditional macOS/iOS UI checks with an API-connected build.
11. Conditional guarded send requiring visible target review, a one-time
    confirmation, and a fresh idempotency key.
12. Fast failure triage by smoke error code and provider symptom.
13. Competition-day checklist, minimal evidence table, state retention, and
    cleanup procedure.

Commands will be macOS shell-first. PowerShell will not be the primary path.
Every command will state whether it runs from the repository root or `server`
directory.

### Operational Boundaries

Preflight is a one-time check immediately before the Demo. Feishu
`lark-cli auth status --json --verify` may contact the provider to confirm the
saved login. DingTalk `dws auth status --format json` may refresh an expired
access token. Neither remote verification command belongs in the Connector
polling loop.

Read smoke exercises:

```text
official CLI
-> real Provider Adapter
-> Connector Host
-> StepFun summary and draft
-> Unified Inbox API
-> sanitized smoke assertions
```

Read smoke never sends. It does not depend on the Apple UI and can be completed
before frontend integration. It must not be described as proof that the
macOS/iOS UI is connected.

UI and send validation are conditional on an API-connected Hush build. The
current Fixture UI cannot supply a real Inbox item ID and cannot be used to
claim a real acknowledgement, edit, or send. Operators must not bypass this
gap by copying private IDs from logs or raw API responses.

StepFun calls use bounded waiting rather than a fully asynchronous job queue.
A timeout can fail the current synchronization attempt and trigger retry with
backoff, but it must not leave the Connector waiting indefinitely.

### Security And Privacy

Examples use placeholders only. The README must not include:

- OAuth access or refresh tokens;
- authorization URLs or device codes;
- real message bodies, names, account identifiers, organization identifiers,
  conversation identifiers, or provider participant identifiers;
- StepFun API keys;
- real `HUSH_APP_TOKEN` or `HUSH_CONNECTOR_TOKEN` values;
- screenshots containing private provider data.

The operator must enter `HUSH_APP_TOKEN` without putting the secret in shell
history. Smoke output is limited to counts, booleans, and stable error codes.

The default `server/.data/unified-inbox-state.json` is sensitive because real
validation can persist messages, drafts, private bindings, and checkpoints.
The runbook must describe its retention and deletion tradeoff: deleting it
requires stopping the server and resets synchronization state, so it occurs
only after restart/checkpoint validation and only when the Demo host should not
retain the data.

Official CLI installs must use fixed versions whose registry integrity has
been checked. The runbook must not execute mutable `latest` or a script from a
repository's mutable `main` branch on the Demo host.

## Document Two: Apple Frontend Handoff

### Purpose And Ownership

The handoff targets the Agent responsible for macOS/iOS Unified Inbox UI. It
does not authorize the backend owner to modify Xcode, signing, entitlements, or
the Apple UI in this branch.

It must identify the current Fixture implementation and state that real mode
requires replacing the Fixture store with an API client while preserving
Sample Mode.

### Required Content

The handoff must document:

1. The Demo topology and base URL selection:
   - macOS App uses loopback when server and App share the Mac;
   - iOS uses the Mac's trusted-LAN IPv4 address;
   - no public exposure or provider credentials in the App.
2. Required request headers:
   - `Authorization: Bearer <HUSH_APP_TOKEN>`;
   - `X-Request-ID`;
   - `X-Client-Version`;
   - `X-Contract-Version: 1.0`;
   - a high-entropy, per-launch `X-Hush-App-Session`.
3. The existing Unified Inbox API sequence for list, detail, acknowledgement,
   draft retrieval/edit, confirmation, and send.
4. `expectedVersion`, one-time confirmation-token, and idempotency-key
   handling.
5. `X-Hush-Data-Origin` handling so Fixture/Mock data can never be displayed as
   real.
6. Loading, empty, unavailable/degraded provider, AI timeout, conflict,
   confirmation expiry, send failure, and ambiguous `unknown` states.
7. UI rules:
   - show provider and human-readable conversation;
   - never display or log private provider IDs;
   - keep item/draft IDs internal;
   - allow draft editing;
   - require visible target and content review before send;
   - never automatically retry an ambiguous send.
8. macOS/iOS integration and acceptance checklists, including Sample Mode
   regression coverage.

The handoff must point frontend implementers to `contracts/openapi.yaml`,
schemas, fixtures, server documentation, and relevant current Swift Fixture
files as sources of truth. It must distinguish currently implemented backend
contracts from frontend work that remains pending.

## Verification

Before committing the documentation:

1. Check every provider CLI flag against the official Feishu and DingTalk CLI
   repositories already reviewed for this implementation.
2. Check Hush configuration and smoke commands against `.env.example`,
   `server/package.json`, and `server/scripts/smoke-inbox.mjs`.
3. Check Apple handoff endpoints and headers against `contracts/openapi.yaml`,
   `server/README.md`, API routes, and current Swift Fixture code.
4. Scan both documents for real-looking secrets and provider identifiers.
5. Run `git diff --check`.
6. Run TypeScript typecheck, production build, and the 182-test Inbox-focused
   suite because the branch also contains implementation changes.
7. Perform independent specification and quality reviews before delivery.

Real account validation remains explicitly pending until the documented
preflight and read smoke run on the authorized macOS Demo host. Apple UI and
send validation remain pending until the API-connected build is integrated.

## Git Delivery

Keep the existing worktree and branch:

```text
feat/w2/unified-inbox-implementation
```

Commit the approved documentation and current Unified Inbox implementation
without force-pushing. Push the branch to `origin` and preserve the worktree
for Demo feedback. Do not merge into `main` or create a Pull Request unless
separately requested.
