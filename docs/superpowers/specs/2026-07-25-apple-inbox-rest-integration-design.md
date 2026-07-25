# Apple Unified Inbox and Dynamic Rest Integration Design

## Goal

Deliver one tested Apple and server integration based on the latest `main` that:

- preserves the merged Unified Inbox backend contract and Dynamic Rest behavior;
- selectively ports the current local visual work without replacing newer functional code;
- connects the Apple Inbox UI to `/v1/inbox/*` for real provider data;
- retains the existing fixture flow as an explicitly selected Sample Mode;
- starts in Real Mode when runtime configuration is present;
- requires only environment variables and third-party credentials after deployment;
- makes the server listen and report health correctly for an environment-selected port.

The implementation must not commit secrets, provider credentials, private provider IDs,
or real message content.

## Baseline and Merge Strategy

The implementation baseline is the latest `origin/main`, which includes PR 21 Dynamic
Rest and PR 22 Unified Inbox. The local `Hush-UnifiedInbox` working tree is a visual
source, not a branch to merge wholesale: it is behind `main` and its root-view changes
would otherwise remove parts of the Dynamic Rest generated-task path.

Port these visual changes selectively:

- the tide timeline, page surface, message reveal, shaders, and required image assets;
- the Breath Tide feature and its explicit opt-in presentation;
- the visual portions of Hush Door and Sleep Handoff;
- Inbox layout and animation while retaining unambiguous Sample/Real labels;
- iOS and macOS styling that does not replace networking, notification, generated-task,
  or lifecycle behavior.

Manually reconcile `HushDemoRootView`, `HushDoorView`, and both App entry points. Preserve
the latest `suggestedGeneratedTask`, generated-task routing, notification, Agent settings,
and companion state while adding the visual state machines.

## Client Architecture

`UnifiedInboxView` renders a presentation state and issues user intents. It does not
decode transport responses or decide whether data is real. The feature has two separate
store implementations behind one small interface:

```text
UnifiedInboxView
        |
UnifiedInboxStore interface
   +-- Sample store: fixture data and in-memory simulated send
   +-- API-backed store: authenticated /v1/inbox/* workflow
```

Sample and Real stores do not share tokens, origin state, confirmation tokens,
idempotency keys, or send state. Transport Codable types follow OpenAPI and the Inbox
schemas. UI-facing types exclude provider account IDs, message IDs, conversation IDs,
participant references, and raw reply target IDs.

The API-backed store owns loading, pagination, selection, revision/version tracking,
draft editing, visible-review state, confirmation lifetime, and send result state. The
API client owns URL construction, headers, JSON encoding/decoding, and response metadata.

## Mode Selection

When a valid Unified Inbox server address and an in-memory `HUSH_APP_TOKEN` are supplied,
the App enters Real Mode directly. Without them, the App shows connection configuration
instead of fixture messages.

Sample Mode remains available only through an explicit, visibly labelled operator action.
It never starts because a Real request failed. Leaving Real Mode or changing its base URL
clears its token and all session-bound confirmation state.

Accepted integration addresses are narrow:

- macOS: HTTPS, or HTTP on `127.0.0.1`/`localhost`;
- iOS: HTTPS, or HTTP on an operator-entered private LAN IPv4 address.

The existing cloud Agent HTTPS validator is unchanged. Apple transport configuration is
limited to the local integration use case; arbitrary public HTTP loads are not enabled.

## API and Security Flow

Each normal Inbox request includes:

- `Authorization: Bearer <HUSH_APP_TOKEN>`;
- a fresh `X-Request-ID` UUID;
- the Apple build version in `X-Client-Version`;
- `X-Contract-Version: 1.0`;
- one 32-128 character `X-Hush-App-Session` value per App launch.

For a request body, `request_id` matches `X-Request-ID`. The App reads
`X-Hush-Data-Origin` on every successful response and rejects missing, unsupported, or
inconsistent values. `real` is the only origin presented as live data; `mock` is Sample,
and `cached` is visibly stale.

The read sequence is sync status followed by all item pages, then a fresh detail request
for selection. Acknowledgement uses the exact displayed item revision. Draft PATCH uses
the exact displayed draft version. Conflicts fetch the latest object and require another
review rather than replaying the mutation.

Real send is a guarded sequence: display current item, provider, conversation, reply
targets, and complete draft; record explicit final review; request a session-bound,
short-lived confirmation; send that exact draft version with one fresh idempotency key.
An expired confirmation, draft edit, base URL change, or App-session change invalidates
the review. Ambiguous transport outcomes are never automatically retried.

Tokens remain in memory and never enter UserDefaults, App Group defaults, source,
Info.plist, logs, screenshots, analytics, or crash metadata. Provider and StepFun
credentials exist only on the server.

## Server Configuration and Ports

Server composition retains replaceable canned and real providers. Dynamic Rest keeps its
StepFun interface, and Inbox intelligence keeps its own StepFun configuration so either
can be tested without live credentials.

The runtime listener uses `PORT`. Container metadata and health checking must not assume
port 3000 at runtime. Deployment succeeds by changing server environment variables only;
no source or image command edit is required for a platform-selected port. Local defaults
may remain 3000.

Required production configuration is documented by capability:

- core: `NODE_ENV`, `HOST`, `PORT`, `PUBLIC_BASE_URL`, `HUSH_APP_TOKEN`,
  `HUSH_CONNECTOR_TOKEN`;
- Dynamic Rest: `HUSH_REST_DECISION_PROVIDER`, `STEPFUN_API_KEY`,
  `STEPFUN_BASE_URL`, `STEPFUN_MODEL`, and timeouts;
- Inbox intelligence: `INBOX_STEPFUN_API_KEY`, `INBOX_STEPFUN_BASE_URL`,
  `INBOX_STEPFUN_MODEL`, and timeouts;
- provider connectors: the existing Lark/DWS paths and account identifiers, plus only
  the credentials needed for enabled providers.

## User-visible States

The Real UI distinguishes initial load, refresh, ready empty state, degraded provider,
unavailable provider, unknown readiness, pagination truncation if imposed, authentication
failure, contract mismatch, origin mismatch, AI timeout, item conflict, draft conflict,
confirmation expiry, explicit send failure, and ambiguous send outcome.

Controls retain stable dimensions during loading and errors. Mutating controls are disabled
while their request is running. An ambiguous send disables further sending until the user
starts a new reviewed action after external verification.

## Test Strategy

Development follows focused tests before implementation changes:

- Codable fixtures and schema-aligned edge cases;
- base URL validation and required-header construction;
- origin gate behavior across pagination and detail/draft flows;
- Sample/Real isolation and no silent fallback;
- exact revision/version conflict behavior;
- confirmation invalidation and idempotency behavior;
- failed versus ambiguous send behavior;
- Dynamic Rest generated-task regression coverage;
- environment-selected listener and health-check port behavior.

Run server typecheck, contract, provider, unit, integration, vertical-slice, deployment,
smoke, and build checks. Build the Apple app for macOS and iOS Simulator and run focused
store/client tests. Start the server locally and exercise Inbox and Dynamic Rest over HTTP.

Without third-party credentials, canned/mock providers must complete the protocol-level
end-to-end path. With credentials supplied only through environment variables, the same
code path must support the real StepFun and Feishu/DingTalk validation runbook.

## Acceptance Criteria

- The latest Dynamic Rest generated-task path remains compiled and tested.
- The selected visual experience is present without wholesale replacement of main files.
- Configured launches enter Real Mode; unconfigured launches request configuration.
- Sample Mode is explicit and all fixture mutations remain visibly simulated.
- All `/v1/inbox/*` read, edit, acknowledgement, confirmation, and send flows are wired.
- Real data is shown only with a consistent `X-Hush-Data-Origin: real` chain.
- Exact revision/version and guarded send invariants are enforced.
- Server port changes require environment configuration only.
- Automated backend and Apple builds/tests pass.
- No secrets or private provider identifiers are persisted or logged.
- Remaining live validation inputs are limited to documented environment variables,
  StepFun credentials, and enabled provider credentials/accounts.

## Out of Scope

- changing the frozen Inbox API contract;
- replacing provider CLIs or adding new providers;
- production Keychain provisioning or account onboarding;
- automatic retry of real sends;
- weakening the existing cloud Agent HTTPS validation;
- unrelated refactors of the Apple application or server.
