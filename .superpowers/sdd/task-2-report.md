# Task 2 — Private Participant Bindings and Group Aggregation

## Implementation

- Added internal participant binding, resolved participant, source-message,
  directory, and repository interfaces.
- Added an in-memory participant directory keyed by
  `provider + accountId + conversationId + participantRef`. It exposes only
  exact `resolve()` calls; there is no provider-ID listing method.
- Added private raw source-message storage per public Inbox item.
- Added one open group digest per
  `provider + account_id + conversation_id`, with provider-message dedupe,
  revision/count increments, public source-field redaction, enrichment reset,
  exact-revision acknowledgement, and 1000-message/24-hour rollover.
- Made enrichment writes revision-aware.
- Extended `InboxSource.pull()` with `participantBindings`. Existing providers
  return an empty list until their participant extraction tasks; no provider
  binding is fabricated.
- Updated the existing Inbox service only enough to pass the item revision to
  `saveEnrichment()`. Acknowledge route/service orchestration remains Task 4.

## Files

- `server/src/inbox/ports.ts`
- `server/src/inbox/in-memory.ts`
- `server/src/application/inbox/inbox-service.ts`
- `server/src/inbox/providers/dingtalk-dws-adapter.ts`
- `server/src/inbox/providers/lark-cli-adapter.ts`
- `server/src/inbox/providers/outlook-graph-adapter.ts`
- `server/src/inbox/providers/provider-fixtures.ts`
- `server/src/inbox/providers/qq-mail-adapter.ts`
- `server/tests/unit/inbox-repositories.test.ts`
- `server/tests/unit/inbox-participants.test.ts`
- `server/tests/unit/connector-host.test.ts`
- `server/tests/vertical-slice/unified-inbox-vertical-slice.test.ts`

The vertical-slice fixture had already become invalid at baseline `cc8b129`
when Task 1 made `conversation_type`, `conversation_name`, and `sender_ref`
required. Its synthetic direct event was minimally updated, and the 202
assertion now runs before the response is dereferenced.

## RED

Requested command:

```bash
cd server
pnpm vitest run tests/unit/inbox-repositories.test.ts tests/unit/inbox-participants.test.ts
```

Output: `/bin/bash: pnpm: command not found`.

Equivalent installed runner:

```bash
./node_modules/.bin/vitest run tests/unit/inbox-repositories.test.ts tests/unit/inbox-participants.test.ts
```

Output: 2 files failed; 11 expected failures and 6 existing passes. Failures
showed missing `changed`, group aggregation, `sourceMessages()`,
`acknowledge()`, stale enrichment rejection, rollover sealing, and participant
directory construction.

## GREEN

```bash
./node_modules/.bin/vitest run tests/unit/inbox-repositories.test.ts tests/unit/inbox-participants.test.ts
```

Output: 2 files passed; 17 tests passed.

The focused tests cover:

- group append revision/count/window updates and public redaction;
- provider-message dedupe without revision/count growth;
- exact and stale acknowledgement behavior;
- 1000-message and 24-hour rollover;
- direct-message independence;
- private source-message retention;
- stale enrichment CAS and append-time enrichment reset;
- exact participant resolution, unknown references, and cross-conversation
  rejection.

## Verification

Final affected Inbox verification:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-repositories.test.ts \
  tests/unit/inbox-participants.test.ts \
  tests/unit/inbox-service.test.ts \
  tests/unit/connector-host.test.ts \
  tests/unit/inbox-intelligence.test.ts \
  tests/unit/inbox-confirmation.test.ts \
  tests/unit/inbox-cli-adapters.test.ts \
  tests/unit/outlook-graph-adapter.test.ts \
  tests/unit/qq-mail-adapter.test.ts \
  tests/unit/composition.test.ts \
  tests/provider-contracts/inbox-provider-kit.test.ts \
  tests/integration/inbox-http.test.ts \
  tests/vertical-slice/unified-inbox-vertical-slice.test.ts
```

Output: 13 files passed; 71 tests passed.

```bash
./node_modules/.bin/tsc --noEmit
git diff --check
```

Output: both completed with exit code 0 and no diagnostics.

The complete repository suite was not run because the task controller
identified existing `pwsh`/listen environment limitations; focused and all
affected Inbox suites were run directly.

## Self-review

- Every accepted group append preserves `conversation_digest` and null public
  `sender`, `sender_ref`, and `content`.
- Dedupe is still exactly
  `provider + account_id + provider_message_id`.
- Open-digest lookup is exactly
  `provider + account_id + conversation_id`.
- Revision conflicts disclose only `current_revision`; participant resolution
  failures do not disclose provider participant IDs.
- Repository getters, list results, source messages, bindings, and resolutions
  are cloned so callers cannot mutate stored state.
- No API route, StepFun integration, provider participant extraction, mention
  sending, persistence, new dependency, credential, or Xcode/Apple change was
  added.

## Concerns

- `pnpm` is unavailable on this container PATH, so the installed local
  `vitest` and `tsc` binaries were used.
- Existing providers deliberately return empty `participantBindings`; Tasks 5
  and 6 will add real extraction.
- Task 4 must consume `changed`, bind pulled participants, summarize
  `sourceMessages()` by exact revision, and expose the acknowledge service/API
  route.

## Reviewer follow-up: window safety, immediate sealing, and key isolation

### RED

Added regression coverage for:

- two group events with `conversation_id: null` creating independent,
  immediately sealed, public-redacted digests;
- out-of-order min/max windows and stable source-message ordering;
- an older event spanning at least 24 hours becoming a separate sealed late
  digest without replacing the current open digest;
- immediate sealing on source message 1000;
- just-before and exact 24-hour behavior;
- duplicate delivery after acknowledgement and automatic sealing;
- provider/account/conversation isolation;
- cross-provider/account/conversation participant resolution rejection;
- bound input, resolved output, and source-message mutation isolation;
- exact stale-conflict details;
- NUL-containing composite-key collision cases.

```bash
./node_modules/.bin/vitest run tests/unit/inbox-repositories.test.ts tests/unit/inbox-participants.test.ts
```

RED output: 2 files failed; 7 expected failures and 18 passes. The failures
were null-ID sealing, chronological min/max updates, stable tie ordering,
late-message window preservation, immediate message-1000 sealing, and
repository/participant composite-key collisions.

### GREEN

The repository now:

- immediately seals group digests without a stable conversation ID and never
  adds them to the open index;
- computes candidate windows with the minimum and maximum source timestamps;
- keeps a too-old message as a separate sealed late digest while preserving the
  current open index;
- seals the current digest and opens a new one when a newer event reaches the
  24-hour boundary;
- sorts private source messages by timestamp and then provider message ID;
- seals and removes the open index as soon as message 1000 is accepted;
- uses `JSON.stringify([...])` for repository, participant, checkpoint, and
  connector composite keys.

Focused GREEN:

```bash
./node_modules/.bin/vitest run tests/unit/inbox-repositories.test.ts tests/unit/inbox-participants.test.ts
```

Output: 2 files passed; 25 tests passed.

Affected Inbox verification:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-repositories.test.ts \
  tests/unit/inbox-participants.test.ts \
  tests/unit/inbox-service.test.ts \
  tests/unit/connector-host.test.ts \
  tests/unit/inbox-intelligence.test.ts \
  tests/unit/inbox-confirmation.test.ts \
  tests/unit/inbox-cli-adapters.test.ts \
  tests/unit/outlook-graph-adapter.test.ts \
  tests/unit/qq-mail-adapter.test.ts \
  tests/unit/composition.test.ts \
  tests/provider-contracts/inbox-provider-kit.test.ts \
  tests/integration/inbox-http.test.ts \
  tests/vertical-slice/unified-inbox-vertical-slice.test.ts
```

Output: 13 files passed; 79 tests passed.

```bash
./node_modules/.bin/tsc --noEmit
git diff --check
```

Output: both completed with exit code 0 and no diagnostics.

### Follow-up self-review

- Null conversation IDs cannot collide in an open-digest index because they
  are never indexed.
- A late digest stores and deduplicates its own raw source message without
  sealing or replacing the current open digest.
- Public `received_at` and `window_ended_at` stay at the chronological maximum;
  `window_started_at` stays at the minimum.
- All automatically or explicitly sealed source messages remain in the global
  provider-message dedupe map, so replay does not create a new digest.
- The changes remain in Task 2's repository/directory/source compatibility
  scope; no Task 3–7 implementation was added.
