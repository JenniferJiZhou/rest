# Hush Local and GitHub Version Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every local Hush line of work, integrate the newest local product and UI work with `JenniferJiZhou/rest` `main`, remove only confirmed generated junk, verify the combined product, and update `origin/main` without force.

**Architecture:** Create recovery branches for all four local worktrees and commit the two dirty worktrees independently so no local UI work is lost. Build the release candidate in an isolated worktree from a freshly fetched `origin/main`, merge only the newest `Hush-UnifiedInbox` snapshot into it, resolve UI conflicts in favor of the newest local product behavior, and retain GitHub-only backend/CI changes. Promote the verified integration commit to `main` only after a final remote race check.

**Tech Stack:** Git worktrees and branches, SwiftUI, Metal, Xcode/xcodebuild, iOS Simulator, TypeScript 5.9, Node.js `>=20.19 <21`, pnpm `>=9 <10`, Vitest.

## Global Constraints

- `origin` must remain `https://github.com/JenniferJiZhou/rest.git`.
- `upstream` must remain `https://github.com/Simon-byte-png/rest.git` and is reference-only.
- Do not force-push or rewrite `origin/main` history.
- Do not delete or omit Swift, Metal, Xcode project changes, UI images, SVG files, UI copy, animations, shaders, or `design-references/`.
- The newest UI baseline is `Hush-UnifiedInbox`; older unique UI work is archived on a separate branch and is not overlaid onto the newest UI.
- Delete only paths proven to be generated or session-specific.
- Do not import `.claude/settings.json` into `main`, and do not delete it from the local source worktree.
- Server verification requires Node.js `>=20.19 <21` and pnpm `>=9 <10`.
- Every update to `origin/main` must be a verified non-force fast-forward.

---

### Task 1: Capture the exact pre-integration state

**Files:**
- Read: all four Hush worktrees and their shared Git metadata
- Create outside repository: `/tmp/hush-consolidation-20260808/`
- Create outside repository: `/tmp/hush-consolidation-20260808/worktrees-before.txt`
- Create outside repository: `/tmp/hush-consolidation-20260808/status-before.txt`
- Create outside repository: `/tmp/hush-consolidation-20260808/remotes-before.txt`

**Interfaces:**
- Consumes: current worktree state and the approved design spec
- Produces: immutable audit text used by Tasks 2, 6, and 7

- [ ] **Step 1: Verify repository and worktree topology**

Run from `/Users/jenniferzhou/Documents/Adventure X/Hush`:

```bash
git rev-parse --show-toplevel
git rev-parse --git-dir
git rev-parse --git-common-dir
git branch --show-current
git worktree list --porcelain
```

Expected: the common repository is `Hush/.git`; four existing workspace worktrees are listed; the current branch is `feat/m1/shared-ui-integration`.

- [ ] **Step 2: Create the audit directory and record worktrees**

```bash
mkdir -p /tmp/hush-consolidation-20260808
git worktree list --porcelain > /tmp/hush-consolidation-20260808/worktrees-before.txt
```

Expected: the file contains `Hush`, `Hush-UnifiedInbox`, `hush-agent-m1-unified-inbox-integration`, and `Hush-UIRasterDebug`.

- [ ] **Step 3: Record every worktree status without modifying it**

```bash
for worktree in Hush Hush-UnifiedInbox hush-agent-m1-unified-inbox-integration Hush-UIRasterDebug; do
  git -C "/Users/jenniferzhou/Documents/Adventure X/$worktree" status --short --branch
done > /tmp/hush-consolidation-20260808/status-before.txt
```

Expected: `Hush` has three modified files; `Hush-UnifiedInbox` has the newest source/UI changes; the two other code worktrees have no tracked modifications.

- [ ] **Step 4: Record and verify remote ownership**

```bash
git remote -v > /tmp/hush-consolidation-20260808/remotes-before.txt
git remote get-url origin
git remote get-url --push origin
git remote get-url upstream
```

Expected: both `origin` URLs are Jennifer's repository and `upstream` is Simon's repository.

- [ ] **Step 5: Fetch Jennifer's current remote and save its exact head**

```bash
git fetch --prune origin
git rev-parse origin/main > /tmp/hush-consolidation-20260808/origin-main-before.txt
git log -1 --format='%H %cI %s' origin/main
```

Expected: `origin/main` resolves to a full commit hash and fetch succeeds.

---

### Task 2: Archive every local version before cleanup or integration

**Files:**
- Modify: Git branch refs only
- Modify in `Hush`: the existing three tracked UI/project files and `.gitignore`, committed exactly as found except for the worktree ignore rule
- Modify in `Hush-UnifiedInbox`: all approved tracked product changes and approved untracked product files
- Preserve untracked: `Hush-UnifiedInbox/.claude/settings.json`

**Interfaces:**
- Consumes: Task 1 audit and all local worktree content
- Produces: four recovery branches, including committed snapshots of both dirty worktrees

- [ ] **Step 1: Create archive refs for the two clean worktrees**

Run from `/Users/jenniferzhou/Documents/Adventure X/Hush`:

```bash
git branch codex/archive-apple-integration-20260808 d2ccaffdf891c152c400dbc2aa13a4e338c23db9
git branch codex/archive-ui-raster-debug-20260808 7b8d9f02c17794c512d127f26069848e22aed680
git show-ref --verify refs/heads/codex/archive-apple-integration-20260808
git show-ref --verify refs/heads/codex/archive-ui-raster-debug-20260808
```

Expected: both archive branches resolve to the specified commits.

- [ ] **Step 2: Snapshot the older dirty `Hush` UI work without importing it into the newest UI**

Run from `/Users/jenniferzhou/Documents/Adventure X/Hush`:

```bash
git switch -c codex/archive-shared-ui-local-20260808
```

Add this exact line to `Hush/.gitignore`:

```gitignore
/.worktrees/
```

Then stage and commit:

```bash
git add .gitignore apps/HushApp/Hush.xcodeproj/project.pbxproj apps/HushApp/MacMenuBar/App/HushMacApp.swift apps/HushApp/iOSApp/App/HushApp.swift
git diff --cached --check
git commit -m "archive: preserve local shared UI work"
```

Expected: the commit contains exactly the three UI/project files plus the worktree ignore rule and the worktree becomes clean. This archive is not merged into the newest UI because its older navigation differs from `Hush-UnifiedInbox`.

- [ ] **Step 3: Create the newest local snapshot branch**

Run from `/Users/jenniferzhou/Documents/Adventure X/Hush-UnifiedInbox`:

```bash
git switch -c codex/archive-unified-inbox-local-20260808
```

Expected: uncommitted files remain present on the new archive branch.

- [ ] **Step 4: Update `.gitignore` only for confirmed generated paths**

Modify `.gitignore` with these exact additions under the Xcode and IDE sections:

```gitignore
apps/HushApp/build/
.superpowers/brainstorm/
.Rhistory
/.worktrees/
```

Do not add `design-references/`, `*.png`, `*.svg`, `*.metal`, `BreathTide/`, or `.claude/` to `.gitignore`.

- [ ] **Step 5: Stage tracked product changes and explicit untracked product content**

```bash
git add -u
git add .gitignore \
  apps/HushApp/Shared/DesignSystem/Wave/Assets \
  apps/HushApp/Shared/Features/BreathTide \
  design-references \
  docs/19_WORK_COMPANION_TRIGGERED_EXIT_ANIMATION_PROMPT.md \
  server/src/agent/prompts/always-on-companion-agent.md
git status --short
```

Expected: all product Swift, Metal, Xcode, images, design references, backend changes, contracts, tests, and documents are staged. `.claude/settings.json`, `.superpowers/`, `apps/HushApp/build/`, and `.Rhistory` are not staged.

- [ ] **Step 6: Audit the snapshot before committing**

```bash
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only | rg '(^|/)(build|DerivedData)(/|$)|\.Rhistory$|server\.pid$' && exit 1 || true
git diff --cached --name-only | rg '^apps/HushApp/.*\.(swift|metal|pbxproj)$|^apps/HushApp/.*\.(png|svg)$|^design-references/'
```

Expected: the junk scan returns no paths and the protected UI scan returns Swift/Metal/project/assets/design-reference paths.

- [ ] **Step 7: Commit the newest local product snapshot**

```bash
git commit -m "feat: preserve latest local Hush product work"
git status --short --branch
```

Expected: only `.claude/settings.json` remains as meaningful untracked local configuration; generated paths are ignored.

- [ ] **Step 8: Record protected UI path and asset hashes**

```bash
git ls-tree -r --name-only HEAD -- apps/HushApp design-references | sort > /tmp/hush-consolidation-20260808/newest-ui-paths.txt
find apps/HushApp/Shared/DesignSystem/Wave/Assets design-references -type f -print0 | sort -z | xargs -0 shasum -a 256 > /tmp/hush-consolidation-20260808/newest-ui-assets.sha256
git rev-parse HEAD > /tmp/hush-consolidation-20260808/newest-snapshot-head.txt
```

Expected: the path manifest includes Breath Tide, Wave assets, Swift files, Metal files, and design references; the hash manifest is non-empty.

---

### Task 3: Quarantine only confirmed generated junk

**Files:**
- Move from source worktree: `apps/HushApp/build/`
- Move from source worktree: `.superpowers/brainstorm/`
- Move from source worktree: `docs/superpowers/specs/.Rhistory`
- Preserve: `.claude/settings.json`
- Create outside repository: `/tmp/hush-consolidation-20260808/quarantine/`

**Interfaces:**
- Consumes: ignored-path rules and completed snapshot from Task 2
- Produces: a clean source worktree and recoverable quarantine until task completion

- [ ] **Step 1: Enumerate and validate exact cleanup targets**

```bash
for target in \
  "/Users/jenniferzhou/Documents/Adventure X/Hush-UnifiedInbox/apps/HushApp/build" \
  "/Users/jenniferzhou/Documents/Adventure X/Hush-UnifiedInbox/.superpowers/brainstorm" \
  "/Users/jenniferzhou/Documents/Adventure X/Hush-UnifiedInbox/docs/superpowers/specs/.Rhistory"; do
  test -e "$target" || continue
  test ! -L "$target"
  stat -f '%HT %N' "$target"
done
```

Expected: targets are inside `Hush-UnifiedInbox`, none is a symbolic link, `build` and `brainstorm` are directories, and `.Rhistory` is a regular file.

- [ ] **Step 2: Move junk to recoverable quarantine rather than deleting immediately**

```bash
mkdir -p /tmp/hush-consolidation-20260808/quarantine
mv "/Users/jenniferzhou/Documents/Adventure X/Hush-UnifiedInbox/apps/HushApp/build" /tmp/hush-consolidation-20260808/quarantine/HushApp-build
mv "/Users/jenniferzhou/Documents/Adventure X/Hush-UnifiedInbox/.superpowers/brainstorm" /tmp/hush-consolidation-20260808/quarantine/superpowers-brainstorm
mv "/Users/jenniferzhou/Documents/Adventure X/Hush-UnifiedInbox/docs/superpowers/specs/.Rhistory" /tmp/hush-consolidation-20260808/quarantine/specs-Rhistory
```

Expected: approximately 196 MB of Xcode output and only session-state files move to quarantine; no UI/product path moves.

- [ ] **Step 3: Verify the source worktree after cleanup**

```bash
git status --short --branch
test -f .claude/settings.json
test -f apps/HushApp/Shared/Features/BreathTide/HushBreathTideView.swift
test -f apps/HushApp/Shared/Features/BreathTide/HushBreathShaders.metal
test -d apps/HushApp/Shared/DesignSystem/Wave/Assets
test -d design-references
```

Expected: the protected UI files remain, `.claude/settings.json` remains local, and cleanup targets no longer appear.

---

### Task 4: Create an isolated integration branch from Jennifer's `main`

**Files:**
- Create worktree: `/Users/jenniferzhou/Documents/Adventure X/Hush/.worktrees/hush-main-consolidation-20260808`
- Create branch: `codex/integrate-local-hush-20260808`

**Interfaces:**
- Consumes: refreshed `origin/main` and `codex/archive-unified-inbox-local-20260808`
- Produces: isolated clean integration workspace

- [ ] **Step 1: Invoke `superpowers:using-git-worktrees` and re-run its isolation detection**

```bash
git rev-parse --git-dir
git rev-parse --git-common-dir
git rev-parse --show-superproject-working-tree
git branch --show-current
```

Expected: `Hush` is the primary checkout and the new integration workspace is not yet present.

- [ ] **Step 2: Ensure the project-local worktree container is ignored**

```bash
git check-ignore -q .worktrees
```

Expected: success. If it fails, add `/.worktrees/` to `.gitignore` on the newest snapshot branch, commit it as `chore: ignore local worktrees`, and rerun the check.

- [ ] **Step 3: Fetch again and create the isolated integration worktree**

```bash
git fetch --prune origin
git worktree add "/Users/jenniferzhou/Documents/Adventure X/Hush/.worktrees/hush-main-consolidation-20260808" -b codex/integrate-local-hush-20260808 origin/main
```

Expected: the new worktree is clean and its HEAD equals the freshly fetched `origin/main`.

- [ ] **Step 4: Record baseline ancestry and cleanliness**

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor origin/main HEAD
```

Expected: clean status and successful ancestry check.

---

### Task 5: Merge the newest product snapshot while protecting UI

**Files:**
- Merge: `codex/archive-unified-inbox-local-20260808`
- Protect: `apps/HushApp/**`
- Protect: `design-references/**`
- Reconcile: `contracts/**`, `server/**`, `.github/**`, `deploy/**`, `docs/**`

**Interfaces:**
- Consumes: clean integration worktree and newest snapshot branch
- Produces: one integrated commit containing both histories

- [ ] **Step 1: Start a non-fast-forward, no-auto-commit merge**

```bash
git merge --no-ff --no-commit codex/archive-unified-inbox-local-20260808
```

Expected: Git stages non-conflicting changes and may report conflicts because the branches diverged.

- [ ] **Step 2: Inventory every conflict before resolving any**

```bash
git diff --name-only --diff-filter=U | sort | tee /tmp/hush-consolidation-20260808/merge-conflicts.txt
git ls-files -u
```

Expected: every conflict has stage 1/2/3 entries and is recorded in the audit directory.

- [ ] **Step 3: Resolve UI-owned conflicts from the newest local snapshot first**

Resolve every recorded UI conflict from the newest local snapshot with this exact loop:

```bash
while IFS= read -r conflict_path; do
  case "$conflict_path" in
    apps/HushApp/*|design-references/*)
      git checkout --theirs -- "$conflict_path"
      git add "$conflict_path"
      ;;
  esac
done < /tmp/hush-consolidation-20260808/merge-conflicts.txt
```

Then list the GitHub-to-local differences for every resolved UI path for manual API/model compatibility review:

```bash
while IFS= read -r conflict_path; do
  case "$conflict_path" in
    apps/HushApp/*|design-references/*)
      git diff origin/main...codex/archive-unified-inbox-local-20260808 -- "$conflict_path"
      ;;
  esac
done < /tmp/hush-consolidation-20260808/merge-conflicts.txt
```

Expected: newest local visuals/navigation remain; any GitHub-only API/model dependency needed by the UI is manually incorporated without changing layout, copy, motion, assets, or shaders.

- [ ] **Step 4: Resolve known local backend/contract changes by three-way review**

Review and resolve these exact local-modified paths without whole-tree checkout:

```text
contracts/fixtures/usage-summary-macos-app.json
contracts/schemas/usage-summary.schema.json
server/src/agent/rest-decision-providers.ts
server/src/application/rest/rest-decision-execution.ts
server/src/domain/contracts.ts
server/src/domain/ports.ts
server/tests/provider-contracts/rest-decision-provider.test.ts
server/tests/unit/rest-decision-execution.test.ts
server/tests/unit/usage-summary.test.ts
```

Inspect all three stages for each of those paths that is actually conflicted:

```bash
for path in \
  contracts/fixtures/usage-summary-macos-app.json \
  contracts/schemas/usage-summary.schema.json \
  server/src/agent/rest-decision-providers.ts \
  server/src/application/rest/rest-decision-execution.ts \
  server/src/domain/contracts.ts \
  server/src/domain/ports.ts \
  server/tests/provider-contracts/rest-decision-provider.test.ts \
  server/tests/unit/rest-decision-execution.test.ts \
  server/tests/unit/usage-summary.test.ts; do
  if git ls-files -u -- "$path" | rg -q .; then
    git show ":1:$path"
    git show ":2:$path"
    git show ":3:$path"
  fi
done
```

Preserve GitHub-only inbox/provider/deployment behavior and local usage-summary/rest-agent fields together. Stage each resolved file by copying its exact name from the fixed nine-path list above into a separate `git add` invocation; do not use a glob or stage the entire tree.

- [ ] **Step 5: Resolve documentation conflicts without deleting either design lineage**

```bash
git diff --name-only --diff-filter=U -- docs
```

Expected: both the GitHub documentation and the local consolidation/rest-agent specifications remain. Resolve only overlapping prose; do not delete distinct documents.

- [ ] **Step 6: Verify no conflicts or junk remain and create the merge commit**

```bash
test -z "$(git diff --name-only --diff-filter=U)"
git diff --cached --check
git diff --cached --name-only | rg '(^|/)(build|DerivedData)(/|$)|\.Rhistory$|server\.pid$' && exit 1 || true
git commit -m "merge: integrate latest local Hush into Jennifer main"
```

Expected: a two-parent merge commit is created with no generated junk.

---

### Task 6: Verify UI preservation and full product health

**Files:**
- Read: integrated source tree
- Create outside repository: `/tmp/HushConsolidatedMac`
- Create outside repository: `/tmp/HushConsolidatedIOS`
- Create outside repository: `/tmp/hush-consolidation-20260808/integrated-ui-paths.txt`

**Interfaces:**
- Consumes: integrated merge commit and Task 2 UI manifests
- Produces: fresh build/test evidence required before promotion

- [ ] **Step 1: Verify protected UI path inventory**

```bash
git ls-tree -r --name-only HEAD -- apps/HushApp design-references | sort > /tmp/hush-consolidation-20260808/integrated-ui-paths.txt
comm -23 /tmp/hush-consolidation-20260808/newest-ui-paths.txt /tmp/hush-consolidation-20260808/integrated-ui-paths.txt
```

Expected: `comm` prints nothing; no newest local UI path is missing.

- [ ] **Step 2: Verify visual asset bytes are unchanged**

```bash
shasum -a 256 -c /tmp/hush-consolidation-20260808/newest-ui-assets.sha256
```

Expected: every Wave asset and design-reference file reports `OK`.

- [ ] **Step 3: Review all integrated differences from the newest UI snapshot**

```bash
git diff --stat codex/archive-unified-inbox-local-20260808..HEAD -- apps/HushApp design-references
git diff codex/archive-unified-inbox-local-20260808..HEAD -- apps/HushApp design-references
```

Expected: no asset deletion and no unintended layout, copy, animation, shader, or navigation regression. Differences are limited to required GitHub API/model compatibility.

- [ ] **Step 4: Build the macOS app from fresh DerivedData**

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme HushMac -destination 'platform=macOS,arch=arm64' -derivedDataPath /tmp/HushConsolidatedMac CODE_SIGNING_ALLOWED=NO build
```

Expected: exit code 0 and `/tmp/HushConsolidatedMac/Build/Products/Debug/HushMac.app` exists.

- [ ] **Step 5: Select an available iOS Simulator destination**

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -showdestinations
```

Expected: at least one available iOS Simulator destination is listed. Record its exact UUID as `HUSH_SIMULATOR_ID` for the next two commands; abort verification if none is available.

- [ ] **Step 6: Build the iOS app**

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination "platform=iOS Simulator,id=${HUSH_SIMULATOR_ID:?}" -derivedDataPath /tmp/HushConsolidatedIOS CODE_SIGNING_ALLOWED=NO build
```

Expected: exit code 0 and the simulator Hush app exists under `/tmp/HushConsolidatedIOS/Build/Products/`.

- [ ] **Step 7: Run Apple tests on the same simulator**

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination "platform=iOS Simulator,id=${HUSH_SIMULATOR_ID:?}" -derivedDataPath /tmp/HushConsolidatedIOS CODE_SIGNING_ALLOWED=NO test
```

Expected: exit code 0 and zero failed tests.

- [ ] **Step 8: Provision the exact server runtime if it is not already present**

Use a project-scoped Node 20.19.4 runtime, not the system Node 24 runtime. Provision it with these exact commands if `/tmp/hush-node20/bin/node` does not already exist:

```bash
mkdir -p /tmp/hush-node20
curl -fL https://nodejs.org/dist/v20.19.4/node-v20.19.4-darwin-arm64.tar.gz -o /tmp/hush-node20.tar.gz
tar -xzf /tmp/hush-node20.tar.gz -C /tmp/hush-node20 --strip-components=1
PATH=/tmp/hush-node20/bin:/usr/bin:/bin corepack enable --install-directory /tmp/hush-node20/bin
PATH=/tmp/hush-node20/bin:/usr/bin:/bin corepack prepare pnpm@9.15.9 --activate
```

Verify the isolated runtime:

```bash
PATH=/tmp/hush-node20/bin:/usr/bin:/bin node --version
PATH=/tmp/hush-node20/bin:/usr/bin:/bin pnpm --version
```

Expected: Node reports `v20.19.4` and pnpm reports `9.15.9`; no global package or shell profile is modified.

- [ ] **Step 9: Run the complete server check**

```bash
cd server
PATH=/tmp/hush-node20/bin:/usr/bin:/bin pnpm install --frozen-lockfile
PATH=/tmp/hush-node20/bin:/usr/bin:/bin pnpm check
```

Expected: TypeScript typecheck, all Vitest tests, and production build pass with zero failures.

- [ ] **Step 10: Verify final repository cleanliness and ancestry**

```bash
git status --short --branch
git merge-base --is-ancestor origin/main HEAD
git merge-base --is-ancestor codex/archive-unified-inbox-local-20260808 HEAD
test "$(git rev-list --parents -n 1 HEAD | wc -w | tr -d ' ')" -ge 3
```

Expected: clean worktree; both histories are ancestors; HEAD is a merge commit.

---

### Task 7: Promote the verified commit to Jennifer's `main`

**Files:**
- Create branch: `codex/recovery-origin-main-20260808`
- Update branch: local `main`
- Push: `origin/main`

**Interfaces:**
- Consumes: verified integration commit and saved pre-integration remote head
- Produces: authoritative GitHub `main` with recovery references

- [ ] **Step 1: Invoke `superpowers:verification-before-completion` and rerun the complete verification commands from Task 6**

Expected: fresh evidence shows all required checks pass; do not rely on earlier output.

- [ ] **Step 2: Create recovery refs for the pre-integration GitHub state and verified candidate**

```bash
git branch codex/recovery-origin-main-20260808 "$(cat /tmp/hush-consolidation-20260808/origin-main-before.txt)"
git branch codex/recovery-verified-integration-20260808 HEAD
git show-ref --verify refs/heads/codex/recovery-origin-main-20260808
git show-ref --verify refs/heads/codex/recovery-verified-integration-20260808
```

Expected: both recovery branches exist and point to distinct, known commits.

- [ ] **Step 3: Perform the final remote race check**

```bash
git fetch --prune origin
test "$(git rev-parse origin/main)" = "$(cat /tmp/hush-consolidation-20260808/origin-main-before.txt)"
git merge-base --is-ancestor origin/main HEAD
```

Expected: `origin/main` has not changed since Task 1 and is an ancestor of the candidate. If the equality test fails, stop; do not push, and reintegrate the new remote head.

- [ ] **Step 4: Update the local `main` ref to the verified candidate**

```bash
git branch -f main HEAD
git rev-parse main
git rev-parse HEAD
```

Expected: both hashes are identical. No existing worktree is switched or overwritten.

- [ ] **Step 5: Push `main` to Jennifer's repository without force**

```bash
git push origin main:main
```

Expected: Git reports a normal fast-forward update to `JenniferJiZhou/rest`; no `--force` option is used.

- [ ] **Step 6: Verify the remote result from a fresh fetch**

```bash
git fetch origin main
test "$(git rev-parse origin/main)" = "$(git rev-parse HEAD)"
git log -1 --format='%H %cI %s' origin/main
git remote -v
```

Expected: remote `main`, local `main`, and the verified integration commit match; `origin` is Jennifer and `upstream` is Simon.

- [ ] **Step 7: Preserve all archive branches and report local worktree roles**

```bash
git for-each-ref --format='%(refname:short) %(objectname:short) %(subject)' 'refs/heads/codex/archive-*' 'refs/heads/codex/recovery-*'
git worktree list
```

Expected: all four original local lines are recoverable; the integration worktree is the verified `main` candidate; no older worktree was deleted.

---

### Task 8: Final handoff and delayed quarantine deletion

**Files:**
- Read: `/tmp/hush-consolidation-20260808/quarantine/`
- Do not delete automatically: quarantine contents

**Interfaces:**
- Consumes: successful remote verification from Task 7
- Produces: clear user report and a recoverable cleanup boundary

- [ ] **Step 1: Report exactly what moved to quarantine**

```bash
du -sh /tmp/hush-consolidation-20260808/quarantine/*
find /tmp/hush-consolidation-20260808/quarantine -maxdepth 2 -type l -print
```

Expected: only Xcode build output, Superpowers session state, and `.Rhistory`; no symlinks and no UI/product source.

- [ ] **Step 2: Keep quarantine until the user has inspected the updated application**

Do not delete `/tmp/hush-consolidation-20260808/quarantine/` during this implementation. Report that it is temporary and can be permanently removed after the user confirms the integrated UI is correct.

- [ ] **Step 3: Deliver the final evidence summary**

Report:

```text
origin/main commit
local main commit
archive branch names and commits
macOS build result
iOS build/test result
server pnpm check result
UI path/hash preservation result
quarantined junk paths and size
currently running/opened app path, if launched
```

Expected: every statement is backed by fresh command output and no completion claim is made for a failed gate.
