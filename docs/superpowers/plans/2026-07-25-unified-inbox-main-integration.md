# Unified Inbox Main Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge latest `origin/main` into the W2 branch while keeping W2 as the only Unified Inbox runtime and contract, retaining main's Dynamic Rest Task, deployment, and Apple work.

**Architecture:** Treat latest main as authoritative outside Unified Inbox and W2 as authoritative inside the `/v1/inbox/*` boundary. Resolve mixed files semantically, remove the W1 mock implementation and its artifact references, and preserve Sample Mode through W2's isolated Demo graph. SwiftUI stays unchanged; its Real Mode implementation is a separate Apple handoff.

**Tech Stack:** Git merge workflow, TypeScript 5.9, Fastify 5, Zod 4, OpenAPI 3.1, AJV, Vitest 3, pnpm 9, Docker/GitHub Actions.

---

### Task 1: Record and Merge the Exact Main Baseline

**Files:**
- Modify through merge: repository tree
- Preserve unchanged from main: `apps/HushApp/**`
- Reference: `docs/superpowers/specs/2026-07-25-unified-inbox-main-integration-design.md`

- [ ] **Step 1: Confirm a clean plan-only starting point**

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count origin/main...HEAD
```

Expected: no unstaged files; `origin/main` is
`4579625d0a8cbdd755aae68f882eca427ad27b5f`; the feature branch contains the
committed design and this plan.

- [ ] **Step 2: Start the normal merge**

Run:

```bash
git merge --no-ff origin/main
```

Expected: Git enters a merge with conflicts. Do not abort, rebase, force-push,
or resolve a mixed file using blanket `ours`/`theirs`.

- [ ] **Step 3: Inventory the actual conflict set**

Run:

```bash
git diff --name-only --diff-filter=U
git status --short
```

Expected: every unmerged file is accounted for before edits begin. Files
outside Unified Inbox use main's behavior; mixed files are resolved in Tasks
2-5.

### Task 2: Make the OpenAPI and Fixture Contract W2-Only

**Files:**
- Modify: `contracts/openapi.yaml`
- Modify: `contracts/schemas/common.schema.json`
- Modify: `contracts/schemas/error-response.schema.json`
- Modify: `contracts/schemas/rest-recommendation.schema.json`
- Modify: `contracts/schemas/rest-suggestion.schema.json`
- Keep: `contracts/schemas/inbox-acknowledge.schema.json`
- Keep: `contracts/schemas/inbox-draft.schema.json`
- Keep: `contracts/schemas/inbox-event-batch.schema.json`
- Keep: `contracts/schemas/inbox-item.schema.json`
- Keep: `contracts/schemas/inbox-send.schema.json`
- Keep: `contracts/schemas/inbox-sync-status.schema.json`
- Remove: `contracts/schemas/unified-inbox.schema.json`
- Keep: `contracts/fixtures/inbox-event-batch-demo.json`
- Keep: `contracts/fixtures/inbox-item-enriched-demo.json`
- Keep: `contracts/fixtures/inbox-group-digest-demo.json`
- Keep: `contracts/fixtures/inbox-draft-edited-demo.json`
- Remove: `contracts/fixtures/unified-inbox-*.json`
- Modify: `server/src/domain/contracts.ts`
- Modify: `server/tests/contracts/openapi.test.ts`
- Modify: `server/tests/contracts/fixtures.test.ts`
- Remove: `server/tests/contracts/unified-inbox-schema.test.ts`

- [ ] **Step 1: Resolve contract tests to express the canonical surface**

Keep all latest-main Dynamic Rest Task assertions. The Inbox operation matrix
must contain exactly:

```ts
[
  ["/v1/inbox/events:batch", "post"],
  ["/v1/inbox/items", "get"],
  ["/v1/inbox/items/{itemId}", "get"],
  ["/v1/inbox/items/{itemId}:acknowledge", "post"],
  ["/v1/inbox/items/{itemId}/summary", "post"],
  ["/v1/inbox/items/{itemId}/draft", "post"],
  ["/v1/inbox/drafts/{draftId}", "get"],
  ["/v1/inbox/drafts/{draftId}", "patch"],
  ["/v1/inbox/drafts/{draftId}/confirmation", "post"],
  ["/v1/inbox/drafts/{draftId}:send", "post"],
  ["/v1/inbox/sync-status", "get"]
]
```

Keep W2 fixture validation through `FIXTURE_CONTRACTS` and Zod, including the
group-digest privacy assertions and acknowledgement revision parsing. Remove
expectations for `unified-inbox.schema.json` and `unified-inbox-*.json`.

- [ ] **Step 2: Resolve OpenAPI by ownership**

Start from latest main's non-Inbox OpenAPI so Dynamic Rest Task 1.1 remains
present. Replace only all `/v1/inbox/*` paths and Inbox component definitions
with the W2 definitions from the feature parent. W2 Inbox operations must
continue to require the appropriate contract headers, use
`X-Hush-App-Session` on App routes, declare `X-Hush-Data-Origin`, and reference
the six focused Inbox schema files rather than `unified-inbox.schema.json`.

- [ ] **Step 3: Remove the W1 schema and fixtures**

Run:

```bash
git rm -- contracts/schemas/unified-inbox.schema.json
git rm -- contracts/fixtures/unified-inbox-confirmation.json
git rm -- contracts/fixtures/unified-inbox-draft-discarded.json
git rm -- contracts/fixtures/unified-inbox-draft-editable.json
git rm -- contracts/fixtures/unified-inbox-error-unavailable.json
git rm -- contracts/fixtures/unified-inbox-item-acknowledged.json
git rm -- contracts/fixtures/unified-inbox-item-detail.json
git rm -- contracts/fixtures/unified-inbox-items.json
git rm -- contracts/fixtures/unified-inbox-send-simulated.json
git rm -- server/tests/contracts/unified-inbox-schema.test.ts
```

Expected: only W2 Inbox schemas and fixtures remain.

- [ ] **Step 4: Run focused contract checks**

Run from `server/`:

```bash
pnpm vitest run tests/contracts/openapi.test.ts tests/contracts/fixtures.test.ts
```

Expected: both files pass, all local OpenAPI references resolve, and all
registered fixtures validate.

### Task 3: Preserve Main Rest Runtime and Register Only W2 Inbox

**Files:**
- Modify: `server/src/api/create-server.ts`
- Keep: `server/src/api/inbox-routes.ts`
- Remove: `server/src/api/unified-inbox-mappers.ts`
- Modify: `server/src/composition.ts`
- Modify: `server/src/config.ts`
- Modify: `server/src/domain/ports.ts`
- Remove: `server/src/domain/unified-inbox.ts`
- Keep: `server/src/application/inbox/inbox-service.ts`
- Remove: `server/src/application/inbox/unified-inbox-service.ts`
- Remove: `server/src/infra/unified-inbox-providers.ts`
- Modify: `server/src/infra/in-memory.ts`
- Modify: `server/tests/unit/composition.test.ts`
- Modify: `server/tests/unit/config.test.ts`
- Modify: `server/tests/integration/server.test.ts`
- Modify: `server/tests/integration/http-contract.test.ts`

- [ ] **Step 1: Resolve the runtime-facing tests first**

Preserve main's Dynamic Rest Provider/router assertions and W2 assertions that:

```ts
expect(dependencies.demoInbox).not.toBe(dependencies.inbox);
expect(dependencies.demoInboxOrigin).toBe("mock");
expect(dependencies.inboxOrigin).toBe(expectedRealOrigin);
```

Retain tests for independent normal/demo state, configured provider origins,
credential-gated real mode, StepFun timeout configuration, and health origin.
Remove imports and expectations for `UnifiedInboxService`,
`UnifiedInboxProvider`, `CannedUnifiedInboxProvider`, and
`UnavailableUnifiedInboxProvider`.

- [ ] **Step 2: Resolve `create-server.ts`**

Preserve main's Rest 1.1 route behavior and W2's shared middleware, error
mapping, authentication, demo-token graph selection, request ID handling, and
origin headers. The dependency type must expose W2 `InboxService` and the file
must register Inbox exactly once:

```ts
import type { InboxService } from "../application/inbox/inbox-service.js";
import { registerInboxRoutes } from "./inbox-routes.js";

registerInboxRoutes(server, (request, reply) =>
  requestContext(request, reply, dependencies, true, "inbox")
);
```

Do not keep any inline W1 `/v1/inbox/*` handlers or W1 mapper imports.

- [ ] **Step 3: Resolve `composition.ts`**

Preserve main's Dynamic Rest Task provider construction. Overlay W2's
Connector Host, real provider adapters, StepFun Inbox intelligence,
file-backed real state, in-memory Demo state, fixture Demo intelligence and
senders, and distinct `inbox`/`demoInbox` service instances. Real mode must
remain credential-gated and must never fall back to fixture senders.

- [ ] **Step 4: Remove duplicate W1 runtime files**

Run:

```bash
git rm -- server/src/api/unified-inbox-mappers.ts
git rm -- server/src/application/inbox/unified-inbox-service.ts
git rm -- server/src/domain/unified-inbox.ts
git rm -- server/src/infra/unified-inbox-providers.ts
```

Then remove W1-only exports/imports from `server/src/domain/ports.ts` and
`server/src/infra/in-memory.ts`, while preserving unrelated main changes.

- [ ] **Step 5: Verify the runtime composition**

Run from `server/`:

```bash
pnpm typecheck
pnpm vitest run tests/unit/config.test.ts tests/unit/composition.test.ts tests/integration/server.test.ts tests/integration/http-contract.test.ts
```

Expected: typecheck passes; Rest 1.1 and W2 graph-isolation tests pass; Fastify
does not report duplicate Inbox routes.

### Task 4: Retire W1 Tests and Migrate Deployment Artifacts

**Files:**
- Remove: `server/tests/integration/unified-inbox-http.test.ts`
- Remove: `server/tests/integration/unified-inbox-smoke-script.test.ts`
- Remove: `server/tests/provider-contracts/unified-inbox-provider.test.ts`
- Remove: `server/tests/unit/unified-inbox-service.test.ts`
- Remove: `server/tests/vertical-slice/unified-inbox-vertical.test.ts`
- Keep: `server/tests/integration/inbox-http.test.ts`
- Keep: `server/tests/integration/inbox-smoke-script.test.ts`
- Keep: `server/tests/provider-contracts/inbox-provider-kit.test.ts`
- Keep: `server/tests/provider-contracts/inbox-provider.contract.ts`
- Keep: `server/tests/unit/inbox-*.test.ts`
- Keep: `server/tests/unit/connector-host.test.ts`
- Keep: `server/tests/vertical-slice/unified-inbox-vertical-slice.test.ts`
- Remove: `scripts/smoke-unified-inbox.ps1`
- Keep: `server/scripts/smoke-inbox.mjs`
- Modify: `.dockerignore`
- Modify: `Dockerfile`
- Modify: `.github/workflows/publish-staging-image.yml`
- Modify: `server/src/infra/contract-validator.ts`
- Modify: `server/tests/unit/deployment-artifacts.test.ts`
- Modify: `server/tests/integration/deployment-readiness.test.ts`
- Modify: `server/vitest.config.ts`

- [ ] **Step 1: Remove the W1-only test and smoke surface**

Run:

```bash
git rm -- scripts/smoke-unified-inbox.ps1
git rm -- server/tests/integration/unified-inbox-http.test.ts
git rm -- server/tests/integration/unified-inbox-smoke-script.test.ts
git rm -- server/tests/provider-contracts/unified-inbox-provider.test.ts
git rm -- server/tests/unit/unified-inbox-service.test.ts
git rm -- server/tests/vertical-slice/unified-inbox-vertical.test.ts
```

Expected: W2's 16 focused test files and `server/scripts/smoke-inbox.mjs`
remain.

- [ ] **Step 2: Remove obsolete fixture packaging**

Preserve main's multi-stage non-root image, Zeabur behavior, workflow pins,
health smoke, and Dynamic Rest changes. Remove only:

```text
Dockerfile: COPY contracts/fixtures/unified-inbox-items.json
.dockerignore: !contracts/fixtures/unified-inbox-items.json
publish-staging-image.yml: contracts/fixtures/unified-inbox-items.json path filters
```

Update deployment tests to assert the W2 smoke script and no longer require
the deleted W1 fixture or PowerShell smoke. Keep all unrelated deployment
assertions.

- [ ] **Step 3: Merge contract validator registrations**

Keep latest main's new Rest fixtures and W2's existing Inbox fixture entries.
The resulting `FIXTURE_CONTRACTS` must include W2's four Inbox fixtures:

```ts
[
  "inbox-event-batch-demo.json",
  "inbox-item-enriched-demo.json",
  "inbox-group-digest-demo.json",
  "inbox-draft-edited-demo.json"
]
```

It must not include a `unified-inbox-*.json` fixture.

- [ ] **Step 4: Resolve Vitest settings**

Keep the union of compatible settings required by both branches. Retain W2's
30-second hook timeout and reset/restore behavior unless latest main requires
a stricter compatible value. Do not exclude either Rest or Inbox suites.

- [ ] **Step 5: Run deployment and W2 focused tests**

Run from `server/`:

```bash
pnpm test:deployment
./node_modules/.bin/vitest run tests/unit/inbox-cli-adapters.test.ts tests/unit/inbox-intelligence.test.ts tests/unit/connector-host.test.ts tests/unit/config.test.ts tests/unit/composition.test.ts tests/unit/inbox-service.test.ts tests/integration/inbox-http.test.ts tests/integration/inbox-smoke-script.test.ts tests/unit/inbox-confirmation.test.ts tests/unit/inbox-file-state.test.ts tests/unit/inbox-participants.test.ts tests/unit/inbox-repositories.test.ts tests/unit/outlook-graph-adapter.test.ts tests/unit/qq-mail-adapter.test.ts tests/provider-contracts/inbox-provider-kit.test.ts tests/vertical-slice/unified-inbox-vertical-slice.test.ts --pool=forks --maxWorkers=1
```

Expected: deployment checks pass and all 16 W2 files pass. Record the actual
test count rather than assuming the pre-merge count of 183.

### Task 5: Align Documentation Without Changing Apple Code

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `server/README.md`
- Modify: `docs/18_ZEABUR_STAGING_DEPLOYMENT.md`
- Modify: `docs/21_UNIFIED_INBOX_CONTRACT_AND_SWIFT_MAPPING.md`
- Keep: `docs/unified-inbox-apple-frontend-handoff.md`
- Keep: `docs/unified-inbox-external-validation.md`
- Keep: `docs/feishu-dingtalk-real-validation/README.md`
- Preserve exactly from main: `apps/HushApp/**`

- [ ] **Step 1: Resolve repository and server guidance**

Use main's current repository instructions, Dynamic Rest status, and Zeabur
deployment guidance. Add links to the W2 real-account validation runbook and
Apple handoff. Remove statements that identify the W1 mock provider or its
PowerShell script as the active Inbox runtime.

- [ ] **Step 2: Retire the W1 Apple mapping document as an active contract**

Replace `docs/21_UNIFIED_INBOX_CONTRACT_AND_SWIFT_MAPPING.md` with a concise
compatibility notice that states:

```text
The PR #18 W1 mock wire format is retired.
The canonical runtime contract is contracts/openapi.yaml.
The canonical Apple integration guide is
docs/unified-inbox-apple-frontend-handoff.md.
```

Do not retain DTO field mappings that conflict with W2.

- [ ] **Step 3: Confirm Apple source files match main exactly**

Run:

```bash
git diff --exit-code origin/main -- apps/HushApp
```

Expected: no diff. This merge preserves main's Apple work but makes no new
SwiftUI/Xcode changes.

- [ ] **Step 4: Scan documentation references**

Run:

```bash
rg -n "unified-inbox\.schema\.json|unified-inbox-items\.json|smoke-unified-inbox\.ps1|UnifiedInboxService|CannedUnifiedInboxProvider" README.md server/README.md docs scripts .github Dockerfile .dockerignore
```

Expected: no active runtime/deployment instructions reference retired W1
artifacts. Historical design documents may name them only when explicitly
describing the retirement.

### Task 6: Finish the Merge and Verify the Complete Tree

**Files:**
- Review: all staged merge changes

- [ ] **Step 1: Prove the merge is fully resolved**

Run:

```bash
git diff --name-only --diff-filter=U
rg -n "^(<<<<<<<|=======|>>>>>>>)" --glob '!server/pnpm-lock.yaml'
git diff --check
git status --short
```

Expected: no unmerged paths, conflict markers, or whitespace errors.

- [ ] **Step 2: Prove there is one Inbox implementation**

Run:

```bash
rg -n 'server\.(get|post|patch).*"/v1/inbox|registerInboxRoutes' server/src
rg -n "UnifiedInboxService|CannedUnifiedInboxProvider|UnavailableUnifiedInboxProvider|unified-inbox-mappers" server/src server/tests
rg -n "unified-inbox\.schema\.json|unified-inbox-items\.json|smoke-unified-inbox\.ps1" . --glob '!docs/superpowers/**' --glob '!.git/**'
```

Expected: Inbox routes are registered only through
`server/src/api/inbox-routes.ts`; all W1 runtime and active artifact searches
are empty.

- [ ] **Step 3: Run full server verification**

Run from `server/`:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands exit zero. Report the exact test file and test counts.

- [ ] **Step 4: Review preservation and scope**

Run:

```bash
git diff --stat HEAD
git diff --cached --stat
git diff --name-status origin/main...HEAD
git diff --exit-code origin/main -- apps/HushApp
git status --short
```

Review for secrets, generated files, unintended Apple changes, loss of Dynamic
Rest Task files, and unrelated deletions.

- [ ] **Step 5: Create the merge commit**

Run:

```bash
git add --all
git commit
```

Use Git's merge message, with an explanatory body recording W2 Inbox
ownership, W1 replacement, and preservation of main's Rest/deployment/Apple
changes.

### Task 7: Push Normally and Confirm PR #22 Is Mergeable

**Files:**
- No repository file changes

- [ ] **Step 1: Re-run post-commit safety checks**

Run:

```bash
git status --short --branch
git log --oneline --decorate -3
git merge-base --is-ancestor origin/main HEAD
```

Expected: clean worktree and latest main is an ancestor of the feature branch.

- [ ] **Step 2: Push without rewriting history**

Run:

```bash
git push origin feat/w2/unified-inbox-implementation
```

Expected: normal fast-forward update of the remote feature branch.

- [ ] **Step 3: Verify GitHub's synthetic PR merge**

Run:

```bash
git fetch origin refs/pull/22/merge
git show --no-patch --oneline FETCH_HEAD
```

Expected: `refs/pull/22/merge` exists and points to a GitHub-generated merge
commit. If GitHub has not regenerated it yet, inspect PR #22 checks and
mergeability without merging the PR.

- [ ] **Step 4: Report the evidence**

Report:

```text
Changed: W2 is the sole Inbox contract/runtime; W1 artifacts were removed;
main Rest/deployment/Apple changes were preserved.
Verification: typecheck, full test count, focused 16-file count, build,
deployment checks, and synthetic PR merge ref.
Not claimed: real Feishu/DingTalk account validation and SwiftUI Real Mode
connection.
```
