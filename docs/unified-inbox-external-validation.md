# Unified Inbox External Validation

This is the short engineering acceptance checklist for the competition Demo.
Use these detailed documents for execution:

- macOS/iOS real-account Runbook:
  `docs/feishu-dingtalk-real-validation/README.md`
- Apple frontend Agent API handoff:
  `docs/unified-inbox-apple-frontend-handoff.md`

The Demo host is a Mac. It runs the official Feishu/DingTalk CLI, Hush Server,
Connector, and StepFun integration. The macOS App connects over loopback; the
iOS App connects to that Mac over a trusted LAN. Windows is not required.

Outlook and QQ Mail are not prerequisites for the Feishu/DingTalk Demo.

## Safety gate

- [ ] Use the pinned CLI versions and exact executable paths from the detailed
      Runbook.
- [ ] Keep provider login in the official CLI credential store.
- [ ] Keep Hush and StepFun secrets only in the local permission-restricted
      `.env`; never record them in evidence or shell history.
- [ ] Use a fresh permission-restricted validation state file.
- [ ] Use loopback for macOS, or a private trusted LAN for iOS. Do not use
      public Wi-Fi, public exposure, or a public tunnel.
- [ ] Use a second participant and non-sensitive direct/group test messages.
- [ ] Record no message text, raw JSON, IDs, tokens, logs, or private
      screenshots.

## Backend PASS

Run the provider-specific preflight and read smoke exactly as documented.
Backend PASS requires all of:

```text
official CLI preflight PASS
sync_ready=true
stepfun_summary=true
private_id_fields=false
```

The read smoke does not send a provider message. Token verification is a
one-time provider preflight; normal Connector polling reads messages without
repeating network token verification.

After a passing read, restart the backend and confirm that the fresh validation
checkpoint resumes without creating a duplicate digest.

## Full Demo PASS

The current SwiftUI Unified Inbox uses:

```text
UnifiedInboxDemoStore.items = .fixture
```

It can prove only Sample Mode. It cannot prove real list/detail rendering,
exact-revision acknowledgement, draft editing, or real send.

Full Demo PASS additionally requires an API-connected Apple build to verify:

- [ ] `X-Hush-Data-Origin: real` for the complete real flow.
- [ ] macOS loopback or iOS trusted-LAN real list/detail rendering.
- [ ] Exact displayed digest revision acknowledgement.
- [ ] Draft edit using the exact displayed `expected_version`.
- [ ] Visible provider, conversation, final draft, and reply-target review.
- [ ] App-session-bound confirmation and guarded send of that reviewed version.
- [ ] Explicit failed and ambiguous send states; ambiguous send is never
      automatically retried.
- [ ] No provider IDs, participant IDs, or credentials in Apple UI/logs.

Until that Apple build exists, record these UI/send checks as `BLOCKED` or
`SKIPPED`, never `PASS`. There is no CLI send fallback.

## Evidence

Use only `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED`. Record provider, date/time,
CLI preflight result, backend read-smoke result, Apple integration result,
summary/draft UI result, guarded-send result, and operator initials.

Stop after the first failure or ambiguous send. Follow the detailed Runbook's
failure triage and cleanup sections; do not repeatedly reauthorize, bypass the
App with internal IDs, or directly retry an ambiguous send.
