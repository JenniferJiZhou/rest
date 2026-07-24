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
