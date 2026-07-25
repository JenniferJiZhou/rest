# Task 4 — Revision-Safe Enrichment, Acknowledgement, and Sending

## Implementation

- Changed `InboxService.ingest(batch, participantBindings?)` to validate the
  public batch, bind private participant mappings before upserts, count every
  distinct accepted raw event, and enrich each distinct changed Inbox item
  exactly once per batch.
- Captured the changed item revision and used it as a compare-and-set guard for
  enrichment success, enrichment failure, and draft attachment.
- Added a sanitized `markEnrichmentFailed()` repository boundary. AI failures
  preserve the raw item, set `sync_status: "failed"`, and pass only the fixed
  reason `ai_enrichment_failed`.
- Generated a draft only when `needs_reply` is true.
- Made draft attachment require both the expected item revision and an empty
  current `draft_id`. A late draft may remain as an unreferenced repository
  object, but cannot replace the current revision's draft or a user-edited
  draft.
- Added `InboxService.acknowledge(itemId, expectedRevision)` and the escaped
  Fastify `:acknowledge` route using the existing request schema and
  request-ID checks.
- Added private participant resolution for reply targets. Target resolution
  runs inside the idempotent create callback before confirmation consumption
  and draft claim. Unknown or cross-scope targets therefore leave both the
  one-time confirmation and draft state untouched.
- Added reply target IDs to the send request hash and passed only resolved
  participants to `InboxSender.send()` as `mentions`.
- Preserved direct-message confirmation, draft version, one-time token,
  idempotency replay, and ambiguous-send behavior. Direct sends carry an empty
  mention list.
- Kept raw provider participant IDs out of the HTTP ingestion schema and app
  responses. `ConnectorHost` is the only ingestion caller changed to pass
  `pull().participantBindings` as the private second argument.

## Files

Primary implementation and Task 4 tests:

- `server/src/application/inbox/inbox-service.ts`
- `server/src/api/inbox-routes.ts`
- `server/src/inbox/ports.ts`
- `server/src/inbox/in-memory.ts`
- `server/src/inbox/connector-host.ts`
- `server/tests/unit/inbox-service.test.ts`
- `server/tests/integration/inbox-http.test.ts`
- `server/tests/unit/connector-host.test.ts`
- `server/tests/unit/inbox-repositories.test.ts`

Port-shape compatibility updates adding explicit empty mentions:

- `server/tests/provider-contracts/inbox-provider-kit.test.ts`
- `server/tests/unit/inbox-cli-adapters.test.ts`
- `server/tests/unit/outlook-graph-adapter.test.ts`
- `server/tests/unit/qq-mail-adapter.test.ts`

## RED

The requested package-manager command could not start:

```bash
cd server
pnpm vitest run ...
```

Output: `/bin/bash: pnpm: command not found`.

The installed local Vitest binary was used with one fork worker.

### Batch orchestration and AI degradation

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-service.test.ts \
  --reporter=verbose --pool=forks --maxWorkers=1
```

Output: 1 file failed; 3 tests failed and 12 passed. The expected failures
showed:

- three accepted group messages were incorrectly reported as one accepted
  item and two duplicates;
- `needs_reply: false` still created a draft;
- an AI failure left the raw item `pending` instead of marking it failed.

### Late AI draft race

The controlled-promise summary success and summary failure races already
passed after revision-aware enrichment failure handling. The new controlled
draft race failed as expected:

```text
expected current draft "draft-1", received late "draft-2"
```

Output: 1 file failed; 1 test failed and 17 passed.

### Acknowledgement and send target gate

Output: 1 file failed; 5 tests failed and 17 passed. The expected failures
were:

- missing `InboxService.acknowledge`;
- group send rejected because public digest `sender` is null;
- cross-scope target rejection occurred at the wrong gate;
- direct send omitted `mentions: []`;
- reply targets were absent from the send idempotency hash.

### HTTP acknowledgement route

```bash
./node_modules/.bin/vitest run \
  tests/integration/inbox-http.test.ts \
  --reporter=verbose --pool=forks --maxWorkers=1
```

Output: 1 file failed; 1 test failed and 5 passed. The group digest reached
revision 3 correctly, but `POST ...:acknowledge` returned 404.

The HTTP test that submits `participant_bindings` passed immediately with a
sanitized 400, confirming the strict public schema already rejected private
provider IDs.

### Local connector binding transport

```bash
./node_modules/.bin/vitest run \
  tests/unit/connector-host.test.ts \
  --reporter=verbose --pool=forks --maxWorkers=1
```

Output: 1 file failed; 1 test failed and 5 passed. The local ingest spy
received only the public batch and not the private binding second argument.

## GREEN

Incremental GREEN evidence:

- batch orchestration and AI degradation: 15/15 service tests;
- late summary/draft races: 18/18 service tests;
- acknowledgement and send targets: 22/22 service tests;
- HTTP digest/acknowledgement/privacy: 6/6 HTTP tests;
- local connector binding transport: 6/6 connector tests.

The controlled races verify:

- a late successful summary cannot replace revision 2;
- a late failed summary cannot mark revision 2 failed;
- a late draft cannot replace revision 2's user-edited current draft.

## Verification

Final affected verification:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-service.test.ts \
  tests/integration/inbox-http.test.ts \
  tests/vertical-slice/unified-inbox-vertical-slice.test.ts \
  tests/unit/connector-host.test.ts \
  tests/unit/inbox-repositories.test.ts \
  tests/unit/inbox-confirmation.test.ts \
  tests/provider-contracts/inbox-provider-kit.test.ts \
  tests/provider-contracts/local-providers.test.ts \
  tests/unit/inbox-cli-adapters.test.ts \
  tests/unit/outlook-graph-adapter.test.ts \
  tests/unit/qq-mail-adapter.test.ts \
  --reporter=verbose --pool=forks --maxWorkers=1
```

Output: 11 files passed; 83 tests passed.

```bash
./node_modules/.bin/tsc --noEmit --pretty false
git diff --check
```

Output: both exited 0 with no diagnostics.

The complete repository suite was not rerun because the task controller
identified the existing `pwsh`/listen environment limitations. All Task 4 and
affected Inbox repository, confirmation, connector, HTTP, vertical, provider
contract, and provider adapter suites were run directly.

## Self-review

- Batch enrichment is keyed by a `Map<itemId, revision>`, so multiple changed
  raw messages in the same digest cause one AI summary call.
- Duplicate raw events never enter the changed map and never call AI.
- Only AI provider failures are degraded. Repository and non-version errors
  continue to propagate; version conflicts are ignored only where a stale AI
  result is expected.
- Failure reasons are constants and never contain caught provider errors,
  prompts, responses, credentials, message content, or participant IDs.
- Summary save, failure marking, and draft attachment all compare the captured
  revision. Draft attachment also refuses to replace any current draft.
- Target resolution is scoped by provider, account, and conversation. Failed
  resolution occurs before confirmation consumption and draft claim.
- The sender receives resolved targets only after confirmation succeeds and
  the exact draft version is claimed.
- The participant directory, confirmation token, sender object, and provider
  participant IDs are never passed to StepFun.
- HTTP ingestion parses only `InboxEventBatch`; private bindings are accepted
  only by the local method call.
- No provider-native mention formatting, persistence, StepFun environment,
  dependency, Apple/Swift, Xcode, or contract change was added.

## Concerns

- `pnpm` is unavailable on this container PATH, so the installed local
  `vitest` and `tsc` binaries were used.
- Composition intentionally does not create the persistent/shared participant
  directory in this task. Existing providers return empty bindings until
  Tasks 5/6, and Task 8 owns final state-backend composition.
- Provider adapters receive the new resolved `mentions` field but deliberately
  do not render provider-native mentions; that behavior remains Tasks 5/6.
