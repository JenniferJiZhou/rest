# Feishu and DingTalk Real Validation README Design

## Goal

Create a detailed operator runbook at:

```text
docs/feishu-dingtalk-real-validation/README.md
```

The runbook must let a competition teammate start with a designated Windows
computer, authorize one real Feishu or DingTalk account, run a non-sending
end-to-end validation, and perform one guarded send only after reviewing the
draft in Hush.

The root `README.md` will link to the runbook. The existing
`docs/unified-inbox-external-validation.md` remains the shorter engineering
checklist and links to the detailed runbook rather than duplicating all setup
details.

## Audience And Assumptions

The primary reader is a Demo operator who may not know the server internals.
The operator has:

- a Windows computer assigned to Feishu or DingTalk validation;
- permission to complete browser or device-code authorization;
- an organization administrator available when DingTalk CLI access requires
  approval;
- a local checkout of this feature branch;
- Node.js 20.19.x and pnpm 9.15.9 through Corepack;
- a valid StepFun API key stored only in the local `.env`.

The runbook will not assume Outlook or QQ Mail is configured. Those providers
must not block the Feishu or DingTalk Demo.

## Document Structure

The detailed README will use the following execution order:

1. Scope, success criteria, and non-goals.
2. Security rules and values that must never be committed or pasted into issue
   trackers.
3. One-time common machine preparation.
4. Local Hush `.env` configuration, including the distinction between local
   Hush tokens, provider login state, and local account labels.
5. Server startup and health checks.
6. Feishu installation, exact scopes, login, one-time token verification, and
   provider-specific preflight.
7. DingTalk installation, organization CLI approval, login, profile selection,
   and provider-specific preflight.
8. Read-only smoke execution and expected sanitized output.
9. UI checks for direct messages, evolving group digests, StepFun summary,
   reply targets, editable drafts, acknowledgement, checkpoint continuation,
   and duplicate prevention.
10. Guarded send procedure requiring visible target review,
    `HUSH_SMOKE_ALLOW_SEND=true`, a one-time confirmation token, and a fresh
    idempotency key.
11. Fast failure triage by smoke error code and provider symptom.
12. Competition-day checklist, evidence recording template, and rollback
    procedure.

Commands will be PowerShell-first because the designated provider computers
are Windows machines. Commands that must run from the repository root or
`server` directory will state that explicitly.

## Operational Boundaries

Preflight is a one-time check before the Demo. Feishu
`lark-cli auth status --json --verify` may contact the provider to confirm the
saved login. DingTalk `dws auth status --format json` may refresh an expired
access token. Neither remote verification command belongs in the Connector
polling loop.

Read smoke exercises:

```text
official CLI
-> real Provider Adapter
-> Connector Host
-> StepFun summary and draft
-> Unified Inbox API
-> sanitized smoke assertions
```

Read smoke never sends. Send validation remains a separate, manually enabled
step. The runbook must not provide any command that silently enables sending
for future shells or server launches.

StepFun calls have a bounded operational timeout. A timeout may fail the
current synchronization attempt and trigger retry with backoff, but it must not
leave the Connector waiting indefinitely. The runbook will explain this as
bounded waiting rather than claim that AI enrichment is fully asynchronous.

## Security And Privacy

Examples use placeholders only. The README must not include:

- OAuth access or refresh tokens;
- authorization URLs or device codes;
- real message bodies, names, account identifiers, organization identifiers,
  conversation identifiers, or provider participant identifiers;
- StepFun API keys;
- real `HUSH_APP_TOKEN` or `HUSH_CONNECTOR_TOKEN` values;
- screenshots containing private provider data.

Smoke output is limited to counts, booleans, and stable error codes. The
operator records pass/fail evidence without copying message content or
provider IDs.

## Verification

Before committing the runbook:

1. Check every documented CLI flag against the official Feishu and DingTalk CLI
   repositories already reviewed for this implementation.
2. Check every Hush environment variable and command against `.env.example`,
   `server/package.json`, and `server/scripts/smoke-inbox.mjs`.
3. Scan the new documentation for placeholders that look like real secrets or
   identifiers.
4. Run `git diff --check`.
5. Run TypeScript typecheck, production build, and the 182-test Inbox-focused
   suite because the branch also contains implementation changes.
6. Review the staged diff before committing.

Real account validation remains explicitly pending until the documented
preflight and read smoke run on the designated authorized computers.

## Git Delivery

Keep the existing named worktree and branch:

```text
feat/w2/unified-inbox-implementation
```

Commit the approved README and current Unified Inbox implementation without
force-pushing. Push the branch to `origin` and preserve the worktree for Demo
feedback. Do not merge into `main` or create a Pull Request unless separately
requested.
