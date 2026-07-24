# Task 3 — Replace Unified Inbox Intelligence with StepFun

## Implementation

- Replaced the Unified Inbox Anthropic adapter with
  `StepFunInboxIntelligenceProvider` and an injectable
  `StepFunTransport`.
- Added `FetchStepFunTransport`, using native `fetch`, the exact
  `/step_plan/v1/chat/completions` endpoint, bearer authorization,
  `step-3.7-flash`, deterministic JSON mode, optional code-fence removal,
  and strict response parsing.
- Replaced the flattened provider-specific intelligence input with
  conversation metadata, synthetic allowed participants, and safe source
  messages.
- Added actual serialized-prompt chunk bounds of at most 100 messages and
  60,000 characters. A single oversized message is sliced on Unicode code
  points before any request is sent.
- Added map/reduce summarization. Multi-chunk input performs multiple map
  requests followed by exactly one reduce request containing only validated
  map results and allowed participants.
- Validated reply target references after every map and final reduce,
  canonicalized display names from the allowed list, de-duplicated in
  first-seen order, and capped output at 20.
- Kept provider errors and invalid output sanitized without response bodies,
  caught messages, prompts, or credentials in `AppError.details`.
- Updated Fixture and Unavailable implementations to the new contract.
- Updated Inbox service call sites to build intelligence input from
  `InboxRepository.sourceMessages()`. Public group digest sender/content may
  remain null while summarization uses the private source-message view.
- Removed all Claude-based Inbox construction from composition. Normal Inbox
  intelligence remains Unavailable until Task 8 StepFun environment wiring;
  Demo remains Fixture. The separate Rest/Handoff Claude Agent is unchanged.

## Files

- `server/src/inbox/intelligence.ts`
- `server/src/inbox/ports.ts`
- `server/src/application/inbox/inbox-service.ts`
- `server/src/composition.ts`
- `server/tests/unit/inbox-intelligence.test.ts`
- `server/tests/unit/inbox-service.test.ts`
- `server/tests/unit/composition.test.ts`

## RED

Requested command:

```bash
cd server
pnpm vitest run tests/unit/inbox-intelligence.test.ts
```

Output: `/bin/bash: pnpm: command not found`.

Equivalent installed runner:

```bash
./node_modules/.bin/vitest run tests/unit/inbox-intelligence.test.ts
```

Output: 1 file failed; 10 tests failed. The expected failures were missing
StepFun transport/provider constructors and the obsolete flattened Fixture
input.

After the provider/input GREEN, the new service/composition regression tests
were run:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-service.test.ts \
  tests/unit/composition.test.ts
```

Output: 2 files failed; 12 tests failed and 5 passed. Failures showed that the
service still passed flattened public item fields (including null group
digest fields) and composition still attempted to construct the removed
Claude Inbox provider.

A final Fixture regression test first failed with `needs_reply: false` for a
concrete direct request without a synthetic reply target. The minimal fix
kept `reply_targets: []` while independently detecting the request.

## GREEN

Initial Task 3 intelligence GREEN:

```bash
./node_modules/.bin/vitest run tests/unit/inbox-intelligence.test.ts
```

Output: 1 file passed; 10 tests passed.

The tests cover:

- exact StepFun endpoint, model, request body, and bearer header;
- API-key absence from the serialized prompt;
- safe prompt allow-listing and provider/account/conversation/message ID
  exclusion;
- map and final-reduce target validation;
- first-seen de-duplication and 20-target cap;
- 1000-message multi-map plus one reduce;
- 100-message and 60,000-character bounds for every request;
- safe slicing of one oversized message;
- malformed JSON and non-2xx sanitization;
- draft input limited to validated summary fields and target display names;
- Fixture and Unavailable contract behavior.

## Verification

Final affected Inbox verification:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-intelligence.test.ts \
  tests/unit/inbox-service.test.ts \
  tests/unit/composition.test.ts \
  tests/unit/inbox-confirmation.test.ts \
  tests/unit/inbox-cli-adapters.test.ts \
  tests/unit/inbox-repositories.test.ts \
  tests/unit/inbox-participants.test.ts \
  tests/integration/inbox-http.test.ts \
  tests/provider-contracts/inbox-provider-kit.test.ts \
  tests/vertical-slice/unified-inbox-vertical-slice.test.ts
```

Output before the final assertion-only target-cap expansion: 10 files passed;
75 tests passed. The final focused intelligence run and direct typecheck are
recorded again immediately before commit:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-intelligence.test.ts \
  tests/unit/inbox-service.test.ts \
  tests/unit/composition.test.ts
```

Output: 3 files passed; 27 tests passed.

```bash
./node_modules/.bin/tsc --noEmit
git diff --check
```

Output: both exited 0 with no diagnostics.

```bash
rg -n "Anthropic|CLAUDE_" src/inbox src/application/inbox
```

Output: no matches (`rg` exit 1).

The complete repository suite was also run:

```bash
./node_modules/.bin/vitest run
```

Output: 38 files passed, 402 tests passed, and 6 tests skipped. Four suites
failed only on known environment limitations outside Inbox: missing `pwsh`,
`listen EPERM` on `127.0.0.1`, and resulting non-Inbox timeouts. All Task 3
and affected Inbox suites passed in that run.

## Self-review

- The API key exists only in the transport authorization header and provider
  configuration; prompts and errors never contain it.
- Map prompts include only `conversation_name`, display name, synthetic
  `participant_ref`, content, and `received_at`.
- Reduce prompts contain only validated map outputs plus the same conversation
  name and allowed synthetic participants; they never contain original
  messages.
- Draft prompts contain only validated summary fields and target display
  names/reasons, with no provider identity or sending capability.
- Both configurable limits are clamped to the absolute security maxima. A
  prompt that cannot fit is rejected before transport invocation.
- Every target reference must resolve in `allowedParticipants`; final display
  names are taken from that canonical list rather than model output.
- No StepFun SDK, dependency, environment read, real credential, network test,
  Task 4 orchestration, Task 5/6 provider binding, Task 8 configuration, or
  Apple/Xcode change was added.

## Concerns

- `pnpm` is unavailable on this container PATH, so the already installed local
  `vitest` and `tsc` binaries were used.
- Real StepFun composition wiring intentionally remains unavailable until
  Task 8 supplies and validates StepFun environment configuration.
- Tests use recording transports and stubbed native fetch only; no real
  network request or credential was used.

## Reviewer follow-up — complete validation and bounded reduce

### RED

Added map and final-reduce regressions whose outputs contain 20 allowed
targets followed by an invented target:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-intelligence.test.ts -t "invented"
```

RED output: 2 tests failed because both promises incorrectly resolved after
the target loop stopped at the 20-result cap.

Added a 1000-message regression with 10 schema-valid maximal map outputs:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-intelligence.test.ts -t "compacts large"
```

RED output: 1 test failed with sanitized `INBOX_AI_UNAVAILABLE`; no reduce
request was sent because the uncompressed reduce prompt exceeded 60,000
characters.

Added native-fetch regressions for rejected `response.json()`, malformed
fenced content, and an aborted request:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-intelligence.test.ts -t "native fetch|AbortError"
```

RED output: 3 tests failed. The transport ignored the injected fetch
implementation, so malformed responses were classified as generic provider
errors and the asserted original signal never reached the recording fetch.

The reduce privacy regression was characterization coverage: source canaries,
raw-ID-shaped content, and instruction-like text remain in map data only;
the existing map/reduce separation plus the new compact contract kept them
out of the reduce prompt.

### GREEN

- Target validation now traverses every returned target reference before
  first-seen de-duplication and the 20-result output cap.
- Multi-map results are converted to a compact reduce-only contract containing
  a non-empty summary, priority, needs-reply flag, and bounded points, todos,
  and already validated targets.
- The per-result content quota is derived from map-result count. A deterministic
  binary search chooses the largest quota whose fully serialized reduce prompt
  is at most the configured limit.
- If even the minimum valid compact structure cannot fit, summarization returns
  a sanitized invalid-output error before transport invocation.
- Native fetch is injectable without a new dependency. Malformed
  `response.json()`, malformed fenced JSON, and `AbortError` are sanitized;
  the exact caller signal is forwarded unchanged.
- Reduce prompts contain only compact validated map results, conversation name,
  and allowed synthetic participants. The no-tools/no-send policy is repeated
  on the reduce request.

Focused follow-up GREEN:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-intelligence.test.ts \
  tests/unit/inbox-service.test.ts \
  tests/unit/composition.test.ts
```

Output: 3 files passed; 34 tests passed.

Broad Inbox GREEN:

```bash
./node_modules/.bin/vitest run \
  tests/unit/inbox-intelligence.test.ts \
  tests/unit/inbox-service.test.ts \
  tests/unit/composition.test.ts \
  tests/unit/inbox-confirmation.test.ts \
  tests/unit/inbox-cli-adapters.test.ts \
  tests/unit/inbox-repositories.test.ts \
  tests/unit/inbox-participants.test.ts \
  tests/integration/inbox-http.test.ts \
  tests/provider-contracts/inbox-provider-kit.test.ts \
  tests/vertical-slice/unified-inbox-vertical-slice.test.ts
```

Output: 10 files passed; 82 tests passed.

```bash
./node_modules/.bin/tsc --noEmit
git diff --check
```

Output: both exited 0 with no diagnostics.

```bash
rg -n "Anthropic|CLAUDE_" src/inbox src/application/inbox
```

Output: no matches (`rg` exit 1).

### Follow-up concern

Task 4 still owns late-output orchestration. The repository revision check
prevents a late summary from overwriting a newer digest revision, but Task 3
does not add cancellation, changed-item rescheduling, acknowledgement, or
send orchestration.
