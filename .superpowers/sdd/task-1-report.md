# Task 1 — Freeze the Conversation Digest Contract

## Implementation

- Added provider-neutral conversation and item-kind enums, reply targets, acknowledgement requests, digest revision/window/acknowledgement fields, and group-digest redaction validation to the runtime Zod contract.
- Mirrored the snake_case fields in strict JSON Schemas and added the acknowledgement operation to OpenAPI.
- Added only synthetic fixtures. The approved fixture correction uses `participant_demo_0001`, which satisfies the retained `{8,64}` suffix rule.

## Files

- `server/src/domain/contracts.ts`
- `contracts/openapi.yaml`
- `contracts/schemas/inbox-event-batch.schema.json`
- `contracts/schemas/inbox-item.schema.json`
- `contracts/schemas/inbox-acknowledge.schema.json`
- `contracts/fixtures/inbox-event-batch-demo.json`
- `contracts/fixtures/inbox-item-enriched-demo.json`
- `contracts/fixtures/inbox-group-digest-demo.json`
- `server/tests/contracts/fixtures.test.ts`
- `server/tests/contracts/openapi.test.ts`

## RED

Requested command:

```bash
cd server
pnpm vitest run tests/contracts/fixtures.test.ts tests/contracts/openapi.test.ts
```

Output: `/bin/bash: pnpm: command not found`.

Equivalent installed runner:

```bash
./node_modules/.bin/vitest run tests/contracts/fixtures.test.ts tests/contracts/openapi.test.ts
```

Output: 3 expected failures: missing group-digest fixture, missing acknowledge schema export, and missing acknowledge OpenAPI operation; 31 tests passed.

## GREEN and verification

```bash
./node_modules/.bin/vitest run tests/contracts/fixtures.test.ts tests/contracts/openapi.test.ts
```

Output: 2 files passed, 34 tests passed.

```bash
./node_modules/.bin/tsc --noEmit
```

Output: failed outside Task 1's authorized file list because existing Inbox service, provider adapters, fixtures, and integration/unit tests still construct pre-digest `InboxEvent`/`UnifiedInboxItem` values and omit `reply_targets`. The contract test itself has no type errors.

`git diff --check` completed without output.

## Self-review

- Public API fields remain snake_case.
- Source events retain required non-null `sender` and `content`; public group digests require `sender`, `sender_ref`, and `content` to be null.
- JSON Schemas remain strict and the OpenAPI operation references the new schema.
- No SwiftUI/Xcode files, credential files, real identifiers, or unrelated code were modified.

## Concerns

- A follow-on implementation task must update Inbox creators, provider normalization, enrichment, and relevant tests before repository-wide typecheck can pass.

## Reviewer fix follow-up

### Scope and implementation

- Registered `inbox-group-digest-demo.json` in the AJV fixture contract list.
- Added Zod and AJV negative cases for a group digest with a non-null `sender`, `sender_ref`, or `content`.
- Updated the existing repository, intelligence fixture, provider adapters, and typed Inbox fixtures to construct every newly required field without weakening the contract or using unsafe type assertions.
- Raw-message operations now explicitly reject a public digest with no raw sender/content instead of treating its redacted fields as strings. No conversation aggregation, mentions, StepFun, or acknowledgement endpoint implementation was added.

### RED → GREEN

```bash
./node_modules/.bin/vitest run tests/contracts/fixtures.test.ts
```

Initial RED output: 4 expected failures — the group fixture was not AJV-registered, and Zod accepted each non-null group-digest source field. During the first GREEN attempt, the validation hook was attached to an unrelated Rest schema; the same command reported the remaining 3 expected privacy failures. The hook was moved to `unifiedInboxItemSchema`.

Final GREEN command:

```bash
./node_modules/.bin/vitest run tests/contracts/fixtures.test.ts tests/contracts/openapi.test.ts
```

Output: 2 files passed, 39 tests passed.

Focused Inbox verification also passed:

```bash
./node_modules/.bin/vitest run tests/unit/connector-host.test.ts tests/unit/inbox-repositories.test.ts tests/unit/inbox-service.test.ts tests/unit/inbox-confirmation.test.ts
./node_modules/.bin/vitest run tests/provider-contracts/inbox-provider-kit.test.ts tests/unit/inbox-intelligence.test.ts tests/unit/inbox-cli-adapters.test.ts
./node_modules/.bin/vitest run tests/integration/inbox-http.test.ts
```

Output: 23/23 unit, 14/14 provider/intelligence/adapter, and 3/3 integration tests passed.

```bash
./node_modules/.bin/tsc --noEmit
```

Output: passed with no errors.

### Files added or modified by the fix

- `server/src/application/inbox/inbox-service.ts`
- `server/src/inbox/in-memory.ts`
- `server/src/inbox/intelligence.ts`
- `server/src/inbox/providers/{dingtalk-dws-adapter,lark-cli-adapter,outlook-graph-adapter,provider-fixtures,qq-mail-adapter}.ts`
- `server/src/infra/contract-validator.ts`
- `server/tests/contracts/fixtures.test.ts`
- `server/tests/integration/inbox-http.test.ts`
- `server/tests/unit/{connector-host,inbox-repositories,inbox-service}.test.ts`

### Self-review

- The JSON Schema and Zod validator reject all three public group-digest raw-message fields independently.
- The fixture validator covers the valid group digest through AJV and invalid values through `validateValue`.
- Source events remain non-null for raw sender/content; public message items initialize all digest contract metadata with the single-message values.
- `git diff --check` and TypeScript typecheck complete without output.

### Remaining concern

- `pnpm` is unavailable on this container PATH; direct installed `vitest` and `tsc` commands were used for the recorded verification.

## Re-review safety fixes

### Implementation

- Lark and DingTalk adapters now classify only explicit official envelope conversation types: `group` maps to `group`; `p2p` and `direct` map to `direct`; missing or unrecognized values are withheld from normalized events.
- The adapters consume the envelope conversation display name when available and use generic provider labels otherwise. Sender fallbacks use display-name fields only and never fall back to provider user IDs.
- The real intelligence prompt explicitly requires `reply_targets` as an array, permits `[]` only when no safe target exists, and specifies `target_id`, `display_name`, and `reason` for every target. Runtime Zod validation remains required; malformed real-provider output is sanitized as `INBOX_AI_UNAVAILABLE`.

### RED → GREEN

```bash
./node_modules/.bin/vitest run tests/unit/inbox-cli-adapters.test.ts tests/unit/inbox-intelligence.test.ts
```

RED output: 5 expected failures. Existing adapters emitted `direct` for group, missing, and unknown envelopes; DingTalk exposed the `senderId` fallback; and the real-provider prompt did not contain `reply_targets`. The mocked Anthropic constructor was injected successfully, and the missing-`reply_targets` response already followed the required-schema sanitization path.

GREEN output: 2 files passed, 11 tests passed.

Follow-up verification:

```bash
./node_modules/.bin/vitest run tests/contracts/fixtures.test.ts tests/contracts/openapi.test.ts tests/unit/inbox-repositories.test.ts tests/unit/inbox-service.test.ts tests/unit/connector-host.test.ts
./node_modules/.bin/vitest run tests/unit/inbox-cli-adapters.test.ts tests/provider-contracts/inbox-provider-kit.test.ts tests/integration/inbox-http.test.ts
./node_modules/.bin/tsc --noEmit
```

Output: contracts and affected unit tests passed; CLI/provider/integration: 3 files and 17 tests passed; typecheck passed with no output.

### Files

- `server/src/inbox/providers/lark-cli-adapter.ts`
- `server/src/inbox/providers/dingtalk-dws-adapter.ts`
- `server/src/inbox/intelligence.ts`
- `server/tests/unit/inbox-cli-adapters.test.ts`
- `server/tests/unit/inbox-intelligence.test.ts`

### Self-review

- No unknown provider conversation type is presented as direct, and no participant binding, mentions, group aggregation, acknowledgement endpoint behavior, or StepFun work was added.
- Group source events remain raw internal events; the test constructs a public `conversation_digest` and proves the existing Zod redaction constraint accepts only null sender/content fields.
- Valid real-provider JSON with `reply_targets` parses, while an omitted field is rejected and sanitized without supplying a default.

## Third re-review public-item redaction fix

### RED → GREEN

Added a real in-memory repository `upsert → list` regression using an adapter-shaped group event with raw sender, synthetic sender reference, and raw content:

```bash
./node_modules/.bin/vitest run tests/unit/inbox-repositories.test.ts
```

RED output: 1 expected failure. The created public item was `item_kind: "message"` and exposed `sender: "王同学"`, `sender_ref: "participant_demo_0002"`, and raw content.

The repository now classifies only its public representation at creation time: group events become a single `conversation_digest` with all three fields set to `null`; direct events remain `message` items with their source fields intact. This adds no aggregation, revision incrementing, or open-digest state.

GREEN output: 1 file passed, 5 tests passed.

Focused verification:

```bash
./node_modules/.bin/vitest run tests/unit/inbox-repositories.test.ts tests/unit/inbox-service.test.ts tests/integration/inbox-http.test.ts tests/unit/inbox-cli-adapters.test.ts tests/contracts/fixtures.test.ts tests/contracts/openapi.test.ts
./node_modules/.bin/vitest run --maxWorkers=1 --minWorkers=1 tests/integration/inbox-http.test.ts
./node_modules/.bin/tsc --noEmit
```

Output: repository/service/CLI/contracts tests passed; integration passed 3/3; typecheck passed with no output.

### Files

- `server/src/inbox/in-memory.ts`
- `server/tests/unit/inbox-repositories.test.ts`

### Self-review

- Redaction happens before the item enters the repository map, so both creation and list retrieval use the same non-leaking public value.
- The direct path still copies raw source fields and remains `item_kind: "message"`.
