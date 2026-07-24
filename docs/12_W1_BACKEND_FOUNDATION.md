# W1 / P2 Backend Foundation

Status: initialized and executable.

## Delivered boundaries

W1 owns:

- `server/src/api/`
- `server/src/application/`
- `server/src/domain/`
- `server/src/agent/`
- `server/src/jobs/`
- `server/src/content/`
- `server/src/infra/`
- `server/src/bootstrap.ts`
- `server/src/composition.ts`
- `contracts/` after contract-change approval

Gmail Owner owns:

- `server/src/mail/`
- Gmail OAuth and token storage

W2 owns:

- `server/src/messaging/`
- Photon webhook and outbound delivery

W1 defines provider interfaces and owns final composition. Gmail Owner
implements only Gmail adapters; W2 implements only Photon/Messaging adapters.

## Implemented infrastructure

1. Fastify application factory and a side-effect-only bootstrap.
2. Required request, client, contract, idempotency, and demo headers.
3. Unified structured error responses and redacted logs.
4. Zod runtime models mirroring Contract v1.
5. JSON Schema fixture validation and OpenAPI local-reference validation.
6. Deterministic Rest evaluation and fixed-library Quest selection.
7. Claude adapter with schema validation and deterministic fallback.
8. In-memory idempotency, feedback, and Handoff Job repositories.
9. Asynchronous Handoff Job stages, CAS cancellation, polling, terminal states,
   and Job-scoped `AbortSignal` propagation.
10. Gmail-unavailable degradation to `OPEN_LOOPS_ONLY`.
11. Real/Mock service graphs selected by a protected demo token.
12. Type, unit, provider-contract, integration, vertical-slice, and Contract
    fixture verification (149 deterministic tests).
13. Bounded Agent/Mail/Draft/Completion calls with validated timeout settings.
14. Graph-derived `X-Hush-Data-Origin` and isolated normal/Demo completion
    sinks.
15. Opportunistic cleanup for expired terminal Jobs and idempotency claims.

## Handoff state machine

```text
queued
  -> fetching_mail
  -> classifying
  -> creating_drafts
  -> preparing_receipt
  -> completed

Any non-terminal state -> cancelled
Unexpected processing failure -> failed
Gmail unavailable -> continue without Gmail -> completed
```

State transitions use repository compare-and-set expectations. Cancellation
aborts the active provider signal after the state becomes `cancelled`; a late
provider result or timeout handler cannot overwrite that terminal state.

The Agent only proposes classification and draft text. Application code:

- verifies that every input mail has exactly one classification;
- converts missing classifications to `uncertain`;
- decides whether a draft may be created;
- records whether the provider actually saved the draft;
- keeps failed draft proposals as `drafts.saved=false` and
  `held_items:not_saved`;
- builds the coverage-limited Pause Receipt.

## Provider contracts and ownership

`MailProvider.fetchUnread` returns normalized `MailItem` objects. It throws a
typed `AppError` for provider failures. Handoff catches provider failure and
continues with open loops.

`MailProvider.createDraft` must be idempotent by `dedupeKey`. Returning an
existing Gmail draft is valid. Sending mail is outside the contract.

`HandoffCompletionSink.notify` is called only after the repository contains a
successful terminal record and only when `response_channel` is `imessage`.
Completion delivery is auxiliary and internally claimed once per Job. Its
unavailable, timeout, or generic failure is logged with Job/Request
correlation only; it never reverses `succeeded` or clears the summary.

W2 must not change public domain types directly. Required changes use
`CONTRACT-CHANGE` and need W1 plus M1 approval.

## Runtime limitations for the hackathon

- Job and idempotency state are process-local and disappear on restart.
- Expired terminal Jobs and claims are removed on a five-minute-throttled
  opportunistic path when a new Handoff starts; running Jobs are not removed.
- No multi-instance coordination is provided.
- No production database or external queue is initialized.
- The local fallback is intentionally conservative and not a replacement for
  long-term model evaluation.
- Gmail and Photon remain unavailable until their separate Provider Owners
  deliver adapters and W1 wires them.

These are explicit MVP boundaries, not hidden production claims.

## W1-04 Mock Vertical Slice

The vertical slice uses the real Fastify server, HTTP routes, application
services, in-memory repositories, and composition root. Tests inject
`CannedAgentLLM`, local Mail providers, and a
`RecordingMessagingChannel`; no Gmail or Photon adapter is required.

Run only the vertical slice:

```powershell
cd server
pnpm test:vertical
```

Run the complete backend verification:

```powershell
cd server
pnpm typecheck
pnpm test
pnpm build
```

Run an already-started local server through real network requests:

```powershell
.\scripts\smoke-w1-vertical-slice.ps1
```

For Sample Mode, start the server with `HUSH_DEMO_MODE=true` and a private
`HUSH_DEMO_TOKEN`, then pass the same value with `-DemoToken`. The script
contains no token.

Cancellation is cooperative with the Provider boundary: the Job becomes
`cancelled`, then the Job-scoped `AbortController` aborts active Agent, Mail,
Draft, or Completion work. Providers must honor the optional signal. CAS
prevents late completion or timeout handling from replacing `cancelled`.
This runtime hardening does not change Contract v1.

CI is defined in `.github/workflows/server-ci.yml` for Node 20.19.5 and pnpm
9.15.9 with a frozen lockfile. Local execution on another toolchain is useful
diagnostic evidence but is not standard-toolchain certification.
