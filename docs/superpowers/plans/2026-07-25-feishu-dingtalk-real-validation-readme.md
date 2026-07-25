# Feishu, DingTalk, And Apple Demo Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a macOS-first real-provider validation runbook and a separate Apple frontend handoff so the hackathon team can connect macOS/iOS Hush to the existing Unified Inbox backend without confusing Fixture output with real data.

**Architecture:** The macOS Demo host runs the official Feishu/DingTalk CLI, Hush Server, Connector, and StepFun integration. The macOS App connects over loopback; iOS connects to the Mac over a trusted LAN. Backend read smoke is independently verifiable, while UI acknowledgement, editing, and guarded send remain conditional on the frontend Agent replacing the current Fixture store with an API client.

**Tech Stack:** Markdown, macOS shell, Node.js 20.19.x, pnpm 9.15.9, official `lark-cli` 1.0.77, official DingTalk `dws` 1.0.54, Fastify/OpenAPI, SwiftUI handoff documentation.

---

### Task 1: Rewrite The Real Provider Runbook For The Apple Demo

**Files:**
- Modify: `docs/feishu-dingtalk-real-validation/README.md`
- Reference: `.env.example`
- Reference: `server/package.json`
- Reference: `server/scripts/smoke-inbox.mjs`
- Reference: `server/src/inbox/providers/lark-cli-adapter.ts`
- Reference: `server/src/inbox/providers/dingtalk-dws-adapter.ts`
- Reference: `apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxView.swift`

- [x] **Step 1: Replace the Windows topology with the macOS/iOS topology**

Document:

```text
real Feishu or DingTalk
-> official CLI + Hush Server + Connector on macOS
-> StepFun + Unified Inbox API
-> macOS Hush over loopback
-> iOS Hush over trusted LAN
```

State that Windows is not required. State that the current SwiftUI uses
`UnifiedInboxDemoStore.items = .fixture`, does not connect to real channels,
does not expose a real item ID, and cannot pass real UI/send validation.

- [x] **Step 2: Separate backend and full-Demo success criteria**

Backend PASS requires:

```text
official CLI preflight PASS
sync_ready=true
stepfun_summary=true
private_id_fields=false
```

Full Demo PASS additionally requires an API-connected Apple build to complete
list/detail display, exact-revision acknowledgement, draft edit, visible target
review, confirmation, and guarded send. Without that build, record UI/send as
`BLOCKED` or `SKIPPED`, never `PASS`, and never recover an item ID from logs or
raw responses to bypass the UI.

- [x] **Step 3: Replace mutable CLI installation with pinned packages**

Include registry integrity checks and require exact matches:

```bash
npm view @larksuite/cli@1.0.77 dist.integrity
# sha512-xsyUkGS6WsMmxiVHG7Qpl/U8vmi5qoZterAprAMBYQ0/lA5kMjUv5NL2pfDv/Krp2frQme/OtRjD5+jlEw0RPg==

npm view dingtalk-workspace-cli@1.0.54 dist.integrity
# sha512-R1gNPwc7yVgU5VKbyI7FaYNjh2L2+/yBo7cdqEdrBP35Xcnm0yOjJcRbk/EEq31Sk60feSBoQ3RtKVhxwduW+Q==
```

After matching:

```bash
npx @larksuite/cli@1.0.77 install
npm install -g dingtalk-workspace-cli@1.0.54
```

Do not use `@latest`, mutable `main` install scripts, or competition-day
upgrades.

- [x] **Step 4: Convert preparation and commands to macOS shell**

Use:

```bash
node --version
corepack pnpm --version
git branch --show-current
git status --short
cd <repository-root>/server
corepack pnpm install --frozen-lockfile
```

Require Node 20.19.x, pnpm 9.15.9, and branch
`feat/w2/unified-inbox-implementation`.

Keep the local `.env` configuration aligned with `.env.example`, including
different 32-128 character Hush tokens, StepFun timeout, polling limits, CLI
paths, and local account labels. Explain that provider login stays in the CLI
credential store and Outlook/QQ may remain unconfigured.

- [x] **Step 5: Add loopback and trusted-LAN startup modes**

macOS-only App and server:

```text
HOST=127.0.0.1
PUBLIC_BASE_URL=http://localhost:3000
```

iOS on the trusted Demo LAN:

```text
HOST=0.0.0.0
PUBLIC_BASE_URL=http://<mac-lan-ip>:3000
```

Explain how to obtain the Mac LAN IPv4 without recording it in evidence. Limit
firewall access to the trusted network, do not use public Wi-Fi or expose the
server publicly, and link `docs/15_APPLE_MOCK_INTEGRATION_RELEASE.md` only for
LAN mechanics, not as proof of a real API-connected UI.

- [x] **Step 6: Preserve exact provider preflight and read smoke**

Feishu:

```bash
lark-cli config init --new
lark-cli auth login --scope "search:message im:message.reactions:read im:message.send_as_user im:message"
lark-cli --version
lark-cli auth status --json --verify
corepack pnpm smoke:inbox -- --provider feishu --mode read
```

DingTalk:

```bash
dws auth login
dws auth status --format json
dws profile list --format json
corepack pnpm smoke:inbox -- --provider dingtalk --mode read
```

Document `dws auth login --device`, DingTalk CLI Access Management, the
second-participant direct/group test messages, and the sanitized PASS output.
Token verification remains one-time preflight; normal polling reads messages.

- [x] **Step 7: Prevent shell-history exposure of the smoke token**

Do not put the token literal in a shell command. Read the secret without echo
and export it only to the current shell process using an approach compatible
with the documented shell. Explain that the environment value remains
sensitive and must be removed during cleanup.

- [x] **Step 8: Make UI and guarded send conditional**

Keep the detailed macOS/iOS UI checklist, but gate it on an API-connected
build. The send section must require visible provider, conversation, final
draft, and mention review. Only the API-connected App may bind the reviewed
`draftId` and `expectedVersion`, request a session-bound confirmation, and send
with a fresh idempotency key.

Do not offer the CLI smoke send mode as a fallback: it fetches the current
draft at execution time and cannot prove that the exact App-reviewed version
is being sent. Document that any App send without an explicit success response,
including backend `unknown`, network interruption, or timeout, is ambiguous and
must never be automatically retried.

- [x] **Step 9: Document sensitive state retention and cleanup**

Require the validation to start with a nonexistent, dedicated state file:

```text
server/.data/unified-inbox-real-demo.json
```

Require `.env` mode `600`, the state directory mode `700`, and the created
state file mode `600`. Existing state is a STOP condition because it could
produce a false Backend PASS. Delete the dedicated file only after stopping
the server and after checkpoint/restart validation:

```bash
cd <repository-root>/server
rm -- .data/unified-inbox-real-demo.json
```

The path must be explicit, without variables or globs. Warn that deletion
resets checkpoint, digest, draft, confirmation, and idempotency state and can
cause messages inside the lookback window to reappear. If retained, restrict
machine access and never commit or share it.

- [x] **Step 10: Update checklist and evidence states**

The evidence table records only provider, date/time, CLI preflight, backend
read smoke, Apple UI integration, summary/draft UI, guarded send, and operator
initials. Allow `PASS`, `FAIL`, `BLOCKED`, and `SKIPPED`. Never record message
text, raw JSON, IDs, logs, or screenshots with private data.

Run:

```bash
git diff --check -- docs/feishu-dingtalk-real-validation/README.md
```

Expected: exit code 0.

### Task 2: Write The Apple Frontend Agent Handoff

**Files:**
- Create: `docs/unified-inbox-apple-frontend-handoff.md`
- Reference: `contracts/openapi.yaml`
- Reference: `contracts/schemas/inbox-*.schema.json`
- Reference: `contracts/fixtures/inbox-*.json`
- Reference: `server/src/api/inbox-routes.ts`
- Reference: `server/tests/integration/inbox-http.test.ts`
- Reference: `apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxView.swift`

- [x] **Step 1: Identify current Fixture code and ownership**

Point to `UnifiedInboxDemoStore` and `.fixture`. Require preserving Sample Mode
while adding a separate real API-backed store/client. State that this backend
branch does not authorize edits to Xcode, signing, entitlements, or Apple UI.

- [x] **Step 2: Document base URL and authentication**

macOS uses loopback; iOS uses the trusted-LAN Mac address. Every normal Inbox
request uses:

```text
Authorization: Bearer <HUSH_APP_TOKEN>
X-Request-ID: <new UUID per request>
X-Client-Version: <Apple build version>
X-Contract-Version: 1.0
X-Hush-App-Session: <high-entropy value generated once per app launch>
```

The App never receives Feishu/DingTalk credentials or
`HUSH_CONNECTOR_TOKEN`. Do not persist `HUSH_APP_TOKEN` in source, logs, fixtures,
or screenshots. The current general Agent settings accept HTTPS only, so the
Apple Owner must add a separate, narrowly scoped integration/debug
configuration for macOS loopback and iOS trusted-LAN HTTP, including the
required iOS Local Network permission and narrow ATS allowance. Supply the App
token at runtime, keep it in memory only, and never store it in UserDefaults,
Info.plist, or xcconfig.

- [x] **Step 3: Document the exact read and acknowledgement flow**

```text
GET  /v1/inbox/sync-status
GET  /v1/inbox/items?limit=100
GET  /v1/inbox/items/{itemId}
POST /v1/inbox/items/{itemId}:acknowledge
```

The acknowledge body carries the exact displayed digest revision. A conflict
requires refreshing the item and asking the user to review the new revision.

- [x] **Step 4: Document draft edit and send flow**

```text
GET   /v1/inbox/drafts/{draftId}
PATCH /v1/inbox/drafts/{draftId}
POST  /v1/inbox/drafts/{draftId}/confirmation
POST  /v1/inbox/drafts/{draftId}:send
```

PATCH uses `expected_version`. Send uses the current expected version, the
one-time `confirmation_token`, and a fresh `Idempotency-Key`. Confirmation is
short-lived and bound to the App session. Never automatically retry an
ambiguous send.

- [x] **Step 5: Document data-origin and UI states**

Read `X-Hush-Data-Origin` on responses. Only `real` may be presented as real
provider data; `mock`/Fixture stays visibly Demo/Sample and `cached` cannot pass
real Demo validation. Consume list `next_cursor` or visibly report truncation.
Required states: loading, empty, provider unavailable/degraded, AI timeout,
stale version conflict, confirmation expiry, explicit send failure, and
ambiguous unknown.

Keep item/draft IDs internal. Never display/log private provider IDs. Show
human-readable provider/conversation, summary, todos, editable draft, and
reply-target evidence. Require a visible final review before requesting
confirmation.

- [x] **Step 6: Add macOS/iOS acceptance checklist**

Require:

```text
Sample Mode fixture regression passes
macOS loopback real list/detail passes
iOS trusted-LAN real list/detail passes
real/mock origin cannot be confused
acknowledgement uses exact revision
draft stale edit produces refresh UI
confirmation expiry requires reconfirmation
send unknown is not automatically retried
no provider IDs or secrets appear in UI/logs
```

Run:

```bash
git diff --check -- docs/unified-inbox-apple-frontend-handoff.md
```

Expected: exit code 0.

### Task 3: Add Documentation Navigation

**Files:**
- Modify: `README.md`
- Modify: `docs/unified-inbox-external-validation.md`

- [x] **Step 1: Add root README links**

Link both:

```text
docs/feishu-dingtalk-real-validation/README.md
docs/unified-inbox-apple-frontend-handoff.md
```

Describe the first as the macOS/iOS Demo validation runbook and the second as
the Apple frontend API integration handoff.

- [x] **Step 2: Realign the short external checklist**

Remove Windows-only assumptions and add the same two links. Keep it a concise
engineering acceptance checklist rather than duplicating the detailed
runbook. Mark UI/send checks conditional on an API-connected Apple build.

- [x] **Step 3: Check formatting**

Run:

```bash
git diff --check -- README.md docs/unified-inbox-external-validation.md docs/feishu-dingtalk-real-validation/README.md docs/unified-inbox-apple-frontend-handoff.md
```

Expected: exit code 0.

### Task 4: Verify Documentation And Branch

**Files:**
- Verify: all current Unified Inbox implementation and documentation changes

- [x] **Step 1: Verify names, commands, contracts, and private-data boundaries**

Use `rg` to map every documented environment variable to `.env.example` and
`server/src/config.ts`, every smoke command to `server/package.json`, every API
path/header/body to `contracts/openapi.yaml`, and current Fixture claims to
`UnifiedInboxView.swift`.

Scan for real-looking tokens, provider IDs, authorization URLs, device codes,
and secrets. Explanatory prohibited-field names and explicit placeholders are
allowed; real-looking values are not.

- [x] **Step 2: Run typecheck and build**

From `server`:

```bash
./node_modules/.bin/tsc --noEmit --pretty false
./node_modules/.bin/tsc -p tsconfig.build.json --pretty false
```

Expected: both exit code 0.

- [x] **Step 3: Run the Inbox-focused suite**

From `server`:

```bash
./node_modules/.bin/vitest run tests/unit/inbox-cli-adapters.test.ts tests/unit/inbox-intelligence.test.ts tests/unit/connector-host.test.ts tests/unit/config.test.ts tests/unit/composition.test.ts tests/unit/inbox-service.test.ts tests/integration/inbox-http.test.ts tests/integration/inbox-smoke-script.test.ts tests/unit/inbox-confirmation.test.ts tests/unit/inbox-file-state.test.ts tests/unit/inbox-participants.test.ts tests/unit/inbox-repositories.test.ts tests/unit/outlook-graph-adapter.test.ts tests/unit/qq-mail-adapter.test.ts tests/provider-contracts/inbox-provider-kit.test.ts tests/vertical-slice/unified-inbox-vertical-slice.test.ts --pool=forks --maxWorkers=1
```

Expected: 16 files and 183 tests pass. The smoke and vertical tests require a
random local loopback port.

- [x] **Step 4: Review the complete diff**

```bash
git diff --check
git status --short
git diff --stat
git diff
```

Expected: no `.env`, generated output, credentials, Apple UI changes, Xcode
changes, or unrelated refactors.

### Task 5: Commit And Push

**Files:**
- Commit: the approved Unified Inbox implementation, tests, plan, and docs

- [ ] **Step 1: Stage only approved files**

Stage the current Unified Inbox source/test/config changes, root README,
short validation checklist, Apple handoff, real validation README, and this
plan. Do not use `git add -A`.

- [ ] **Step 2: Review staged content**

```bash
git diff --cached --check
git diff --cached --stat
git status --short
```

Expected: only approved files.

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(inbox): prepare real Apple provider demo"
```

- [ ] **Step 4: Push without force**

```bash
git push -u origin feat/w2/unified-inbox-implementation
```

Preserve the worktree. Do not merge to `main` and do not create a Pull Request
unless separately requested.
