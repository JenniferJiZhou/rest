# Unified Inbox Main Integration Design

**Date:** 2026-07-25

**Goal:** Integrate `origin/main` after PR #18 and PR #21 into
`feat/w2/unified-inbox-implementation`, making the W2 real-provider Unified
Inbox the only runtime and public Inbox contract while preserving main's
Dynamic Rest Task, deployment, and Apple changes.

## Decision

The W2 implementation is the source of truth for every `/v1/inbox/*` route.
There will be one Inbox contract, one registered route graph, and one
composition graph.

The PR #18 W1 mock Inbox was an integration scaffold. Its useful Sample Mode
coverage will be represented by the W2 isolated Demo graph and W2 fixtures.
The duplicate W1 runtime, schemas, scripts, and tests will not remain as an
unregistered second implementation.

This integration does not modify SwiftUI, Xcode project files, signing,
entitlements, or Apple target configuration. It aligns the Apple documentation
with the canonical W2 API so the Apple Agent can implement the final client
connection separately.

## Integration Strategy

Create a normal merge commit from the latest `origin/main` into the public
feature branch. Do not rebase or force-push.

Use latest main as the baseline for all non-Inbox behavior:

- Dynamic Rest Task Contract 1.1
- Rest model routing and StepFun client
- deployment and Zeabur changes
- Apple UI and platform changes
- current repository instructions and test configuration

Overlay the W2 implementation only at the Unified Inbox ownership boundary:

- W2 OpenAPI paths and Inbox schemas
- W2 authentication and `X-Hush-App-Session`
- W2 real/mock data-origin behavior
- W2 Connector Host and provider adapters
- W2 StepFun summary/draft orchestration
- W2 persistence, acknowledgement, confirmation, idempotency, and send flow

## PR #18 Replacement

Remove or migrate the duplicate PR #18 Inbox surface:

- `server/src/application/inbox/unified-inbox-service.ts`
- `server/src/api/unified-inbox-mappers.ts`
- `server/src/domain/unified-inbox.ts`
- PR #18-only `UnifiedInboxProvider` ports
- `server/src/infra/unified-inbox-providers.ts`
- duplicate W1 Inbox HTTP, service, provider, schema, smoke, and vertical tests
- duplicate `contracts/schemas/unified-inbox.schema.json`
- duplicate `contracts/fixtures/unified-inbox-*.json`
- `scripts/smoke-unified-inbox.ps1`

Before removal, preserve useful acceptance intent in W2 equivalents:

- deterministic Sample Mode
- list/detail fixture coverage
- editable draft behavior
- explicit confirmation before send
- stale-version handling
- unavailable-provider handling
- no real delivery from Sample Mode

Update deployment and contract-validation references so they use W2 fixtures
or no longer copy obsolete PR #18 fixture files.

## Conflict Resolution

Resolve the current conflict files semantically:

- `AGENTS.md`: keep latest main instructions; preserve only still-relevant W2
  ownership statements without restoring obsolete workflow text.
- `README.md`: keep latest main product/deployment status and add the W2 real
  validation and Apple handoff links.
- `contracts/openapi.yaml`: preserve Dynamic Rest Task 1.1 and all unrelated
  main endpoints; use only W2 definitions for `/v1/inbox/*`.
- `server/README.md`: preserve latest main runtime/deployment guidance and the
  W2 real-provider architecture and security boundaries.
- `server/src/api/create-server.ts`: preserve latest main Rest routing and
  middleware; register only W2 Inbox routes.
- `server/src/composition.ts`: preserve latest main Rest composition and add
  the W2 Inbox service, Demo graph, Connector Host, and origins.
- contract/fixture tests: keep main's unrelated assertions and W2 Inbox
  assertions; remove PR #18-only operation and fixture expectations.
- `server/tests/unit/composition.test.ts`: cover both latest main Rest
  composition and W2 Inbox isolation/origin behavior.
- `server/vitest.config.ts`: retain all non-conflicting timeout/settings
  required by both suites.

No conflict will be resolved by blanket `ours` or `theirs` across a mixed
ownership file.

## Apple Handoff

The current SwiftUI store remains Fixture-only. The integration will keep
Sample Mode intact and update Apple-facing documentation so Real Mode targets
the W2 contract:

```text
GET  /v1/inbox/sync-status
GET  /v1/inbox/items
GET  /v1/inbox/items/{itemId}
POST /v1/inbox/items/{itemId}:acknowledge
GET/PATCH /v1/inbox/drafts/{draftId}
POST /v1/inbox/drafts/{draftId}/confirmation
POST /v1/inbox/drafts/{draftId}:send
```

The future Apple client must use W2 request headers, exact revisions/versions,
session-bound confirmation, a fresh idempotency key, and
`X-Hush-Data-Origin`. It must not receive provider credentials or treat
Fixture output as real.

`docs/unified-inbox-apple-frontend-handoff.md` is the canonical Apple Agent
handoff. Any PR #18 Apple mapping document that remains must point to it and
must not describe the retired W1 wire format as current.

## Compatibility

This intentionally replaces the PR #18 mock wire format. No current SwiftUI
production path consumes that API; the existing message screen uses local
Fixture data. Repository scripts, tests, deployment files, and documentation
that consumed the W1 mock contract will be migrated in the same merge commit.

The W2 Demo graph remains credential-free and isolated. Real mode remains
credential-gated and cannot silently fall back to Fixture data.

## Verification

After resolving the merge:

1. Confirm there are no conflict markers or duplicate `/v1/inbox/*` route
   registrations.
2. Validate OpenAPI references and all contract fixtures.
3. Run TypeScript typecheck and production build.
4. Run the complete repository test suite against the merged tree.
5. Run the focused W2 16-file Inbox suite and confirm the updated test count.
6. Run deployment artifact tests affected by fixture migration.
7. Inspect the complete merge diff for secrets, generated output, Apple/Xcode
   changes not already present in main, and accidental deletions.
8. Push normally and confirm GitHub creates `refs/pull/22/merge`.

Real Feishu/DingTalk Backend PASS still requires the authorized macOS
preflight and read smoke. Automated tests cannot claim real-account success.
