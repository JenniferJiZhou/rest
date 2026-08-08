# Hush Local and GitHub Version Consolidation Design

## Goal

Make `JenniferJiZhou/rest` the authoritative Hush repository and update its
`main` branch with the newest valid local work without losing GitHub-only
history, local UI work, visual assets, backend work, contracts, tests, or
documentation.

## Source of Truth

- GitHub history baseline: `origin/main` from `JenniferJiZhou/rest`.
- Newest local product work: the `Hush-UnifiedInbox` worktree on
  `feat/m1/ui-raster-companion-backup`, including its committed and uncommitted
  source changes.
- Collaboration reference only: `upstream` points to
  `Simon-byte-png/rest`; it is not a push target for this consolidation.

The integration must preserve both sides. Neither the local tree nor GitHub
`main` may replace the other wholesale.

## Safety Model

1. Record the current commits, worktree status, and remote configuration.
2. Create a recoverable local snapshot branch for the newest local product
   work before integration.
3. Commit only product source, product assets, contracts, tests, and relevant
   documentation to the snapshot branch.
4. Build the integration on an isolated worktree created from the refreshed
   `origin/main`.
5. Merge the local snapshot into that integration branch and resolve conflicts
   by file responsibility, not by accepting an entire side.
6. Run the required verification gates.
7. Create a final recovery reference before updating local `main` and pushing
   `main` to `origin` without force.

No history-rewriting push is allowed. If `origin/main` changes after the final
fetch, integration stops and is repeated against the new remote head.

## UI Preservation Rules

UI work is protected content. The consolidation must preserve:

- Swift and Metal source under `apps/HushApp`.
- The Xcode project and target membership changes.
- Wave, Hush Door, Sleep Handoff, Unified Inbox, Demo, and Breath Tide work.
- All files under `apps/HushApp/Shared/DesignSystem/Wave/Assets/`.
- All files under `apps/HushApp/Shared/Features/BreathTide/`.
- All files under `design-references/`, including PNG, SVG, and generation
  source files.
- Any locally modified UI-facing copy, navigation, transitions, animation,
  color, layout, or shader behavior.

For a conflict in a UI-owned file, the local product behavior is the default,
but GitHub-only API or model changes must be incorporated manually if the UI
depends on them. No UI file or visual asset may be deleted merely because it is
currently unreferenced.

## Non-UI Merge Rules

- Preserve GitHub `main` changes to CI, deployment, provider infrastructure,
  inbox contracts, and server behavior unless the local change intentionally
  supersedes the same behavior.
- Preserve local Rest Agent, usage-summary contract, prompt, and test changes.
- Resolve schema and API conflicts by keeping the union of required fields and
  updating affected tests together.
- Keep existing repository naming and structure; do not perform unrelated
  refactors during consolidation.

## Cleanup Classification

### Delete and ignore

Only reproducible or session-specific artifacts may be removed:

- `apps/HushApp/build/` — generated Xcode build products and caches.
- `.superpowers/brainstorm/*/state/server.pid` and related local server-state
  files — transient process state.
- `docs/superpowers/specs/.Rhistory` — local R session history.
- `.DS_Store`, `DerivedData/`, logs, coverage, and other already documented
  generated artifacts if found.

The repository `.gitignore` will be extended only for confirmed generated
paths that are not already covered.

### Preserve but review separately

- `.claude/settings.json` is not classified as build garbage. It will not be
  deleted. It may remain local unless it is confirmed to be shared project
  configuration.
- `StartupProfileData-NonInteractive` in another worktree is not part of the
  newest product snapshot and will not be imported or deleted.

## Integration Flow

```text
dirty local newest work
        |
        v
local recovery snapshot branch
        |
        v
isolated branch from origin/main
        |
        +--- merge product snapshot
        +--- resolve UI conflicts with local UI preserved
        +--- retain GitHub-only backend/CI/history
        |
        v
verification gates
        |
        v
final recovery reference
        |
        v
fast-forward/update local main and non-force push origin/main
```

## Verification Gates

Before `main` is pushed:

1. Confirm the integration worktree is clean and contains no generated build
   directory, process-state files, `.Rhistory`, secrets, or tokens.
2. Compare the protected UI path inventory before and after integration; every
   local UI source and asset must still exist.
3. Build `HushMac` from a clean temporary DerivedData directory.
4. Build the iOS `Hush` scheme for an available simulator without code signing.
5. Run Apple tests supported by the available simulator/toolchain.
6. Run server `pnpm check` with Node `>=20.19 <21` and pnpm `>=9 <10`.
7. Confirm the final commit contains both `origin/main` history and the local
   snapshot history.
8. Fetch `origin` again and verify that the push is a non-force fast-forward.

If a required gate fails, `main` is not pushed. The failure is diagnosed and
fixed on the integration branch while the recovery snapshot remains intact.

## Completion Criteria

- `origin` remains `JenniferJiZhou/rest` and `upstream` remains Simon's
  reference repository.
- The newest local UI and product assets are present in the integrated tree.
- GitHub-only history and functionality are retained.
- Confirmed generated junk is absent and ignored.
- Required builds and tests pass with their specified toolchains.
- `origin/main` is updated without force and matches the verified integration
  commit.
- Recovery branches or tags make the pre-integration local and remote states
  recoverable.
