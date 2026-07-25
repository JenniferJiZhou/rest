# Unified Inbox Apple Frontend Agent Handoff

This document is the implementation handoff for the Agent responsible for the
macOS and iOS Hush App. It defines how the Apple client connects to the
existing Unified Inbox API for the real Feishu/DingTalk Demo.

The API contract is the source of truth:

- `contracts/openapi.yaml`
- `contracts/schemas/inbox-*.schema.json`
- `server/src/api/inbox-routes.ts`
- `server/tests/integration/inbox-http.test.ts`

Use `contracts/fixtures/inbox-*.json` only for Sample Mode and tests. Fixture
data is not evidence that a real provider integration works.

## Ownership boundary

The current Apple implementation is intentionally Fixture-only:

```text
apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxView.swift
UnifiedInboxDemoStore.items = .fixture
```

`UnifiedInboxDemoStore` keeps all send state in memory and its confirmation
dialog explicitly performs a simulated send. Preserve this flow as a visibly
labelled **Sample Mode** regression path.

Add a separate real API-backed client/store and a clear mode boundary. Never
reuse Fixture objects in a way that can present them as live provider data.
The backend branch does not authorize changes to Xcode project files, signing,
entitlements, provisioning, or unrelated Apple UI. Coordinate those changes
with the Apple owner when they are required.

The current Fixture App cannot complete real UI, acknowledgement, draft edit,
confirmation, or send validation. Those checks remain `BLOCKED` until the
API-backed mode is available.

## Demo topology and base URL

The Feishu/DingTalk CLI, Connector, StepFun integration, and Hush Server all
run on the Demo Mac.

For the macOS App on the same Mac:

```text
http://127.0.0.1:3000
```

For the iOS App on the same trusted Demo LAN:

```text
http://<mac-lan-ip>:3000
```

The server must be started with the matching mode described in
`docs/feishu-dingtalk-real-validation/README.md`. Do not expose the server to
the public Internet, use public Wi-Fi, or add a public tunnel for the Demo.
The App must not silently fall back from an unreachable real base URL to
Sample Mode.

The existing `AgentConnectionSettingsModel` accepts HTTPS only and cannot be
reused unchanged for these HTTP URLs. Add a separate Unified Inbox
integration/debug configuration that accepts HTTP only for:

- macOS loopback hosts (`127.0.0.1` or `localhost`)
- the operator-entered private LAN IPv4 address on iOS

Do not weaken the existing cloud Agent HTTPS validation. The Apple Owner must
review any Xcode/Info.plist change and add the narrow integration-target
transport configuration required by the selected host. For iOS this includes
an `NSLocalNetworkUsageDescription`, the first-use Local Network permission
flow, and the narrowest App Transport Security local-network allowance that
works for the chosen direct address. Do not add arbitrary-loads or public-host
exceptions. Test the native URLSession path; Safari liveness is not proof that
the App has these permissions.

Do not hard-code a team member's LAN address, token, or provider account into
source, fixtures, logs, screenshots, Info.plist, xcconfig, or build artifacts.

## Authentication and required headers

Every normal Unified Inbox App request must include:

```http
Authorization: Bearer <HUSH_APP_TOKEN>
X-Request-ID: <new UUID for this request>
X-Client-Version: <Apple build version>
X-Contract-Version: 1.0
X-Hush-App-Session: <per-launch high-entropy value>
```

Generate `X-Hush-App-Session` once for each App launch and reuse it for that
launch only. It must contain 32-128 characters. A confirmation token is bound
to the authenticated App session, so changing the session requires a new
visible review and confirmation.

Generate a new `X-Request-ID` for every request. For requests with a JSON body,
the body's `request_id` must exactly match the `X-Request-ID` header.

For the competition integration/debug build, collect `HUSH_APP_TOKEN` through
a runtime secure-text entry or equivalent secure runtime injection controlled
by the Apple Owner. Keep it in memory only. Clear it when the App terminates,
the operator signs out of real mode, or the real base URL/mode changes; require
re-entry after relaunch. Do not persist it in UserDefaults, App Group defaults,
Info.plist, xcconfig, source, fixtures, or logs. A future production build may
use a Keychain-backed provisioning flow, but do not invent one in this Demo
task.

The Apple App must never receive or store provider/Connector credentials:

- Feishu/DingTalk OAuth tokens, device codes, profiles, or CLI credentials
- `HUSH_CONNECTOR_TOKEN`
- `STEPFUN_API_KEY`

Treat `HUSH_APP_TOKEN`, confirmation tokens, and idempotency keys as secrets.
Do not print request headers or full request/response bodies in production or
Demo logs.

The API contract does return provider account, message, conversation, and
participant-reference fields. Codable transport models must accept those
fields, but the client must drop them when they are not needed or keep them
only in short-lived internal state when required to correlate an API object.
Never display, log, persist, export, or include them in analytics/crash
metadata.

## Data-origin gate

Read `X-Hush-Data-Origin` on every successful Inbox response.

- Only `real` may be presented as real Feishu/DingTalk data.
- `mock` must remain visibly labelled Sample/Demo data.
- `cached` must be labelled stale/cached and cannot satisfy real Demo PASS.
- A missing, unsupported, or inconsistent origin is an error. Do not infer
  `real` from the selected provider, base URL, account label, or message
  appearance.

Keep one origin for a presented flow. Do not combine real list data with a
mock detail, draft, confirmation, or send result. Surface a blocking error if
the origin changes unexpectedly.

## Read flow

Start real mode with:

```text
GET /v1/inbox/sync-status
GET /v1/inbox/items?limit=100
```

The list response contains `next_cursor`. Continue with
`GET /v1/inbox/items?limit=100&cursor=<next_cursor>` until it is `null`, while
preserving the same origin gate for every page. If the client intentionally
caps pagination for the Demo, it must show a truncated-results state rather
than imply the list is complete. Do not log the cursor.

`sync-status` returns one entry per configured account. Render these states:

- `ready`: normal read flow
- `degraded`: show available data with a visible degraded state
- `unavailable`: show the provider as unavailable; do not represent an empty
  list as a successful sync
- `unknown`: show that readiness is not established

Outlook and QQ Mail may be unconfigured during this Demo. Their state must not
block a ready Feishu or DingTalk account.

For a selected item:

```text
GET /v1/inbox/items/{itemId}
```

Use the detail response, not a stale list snapshot, for the displayed
`revision`, `draft_id`, summary, todos, priority, reply requirement, and reply
targets. Keep `itemId` and `draftId` internal to the client.

Do not display, log, or persist `account_id`, `conversation_id`,
`provider_message_id`, `sender_ref`, or reply-target `target_id`. The UI may
show the provider, `conversation_name`, human-readable sender, summary,
important points, todos, priority, draft content, and reply-target
`display_name`/reason.

## Exact-revision acknowledgement

Only acknowledge the exact revision currently visible to the user:

```text
POST /v1/inbox/items/{itemId}:acknowledge
```

Example body:

```json
{
  "schema_version": "1.0",
  "request_id": "<same value as X-Request-ID>",
  "expected_revision": 3
}
```

Do not substitute a revision from a later background refresh. On
`INBOX_VERSION_CONFLICT`, fetch the item again, show the updated content, and
require the user to review and acknowledge the new revision. Never turn the
conflict into an automatic acknowledgement.

## Draft read and edit

The normal flow uses the `draft_id` returned with the item:

```text
GET /v1/inbox/drafts/{draftId}
PATCH /v1/inbox/drafts/{draftId}
```

Example PATCH body:

```json
{
  "schema_version": "1.0",
  "request_id": "<same value as X-Request-ID>",
  "content": "<complete edited draft>",
  "content_type": "text",
  "expected_version": 2
}
```

Use the version from the exact draft shown in the editor. Replace local state
with the returned draft after a successful edit. On
`INBOX_VERSION_CONFLICT`, do not overwrite the server draft: fetch the latest
version and ask the user to review the change before editing or sending.

The API also exposes `POST /v1/inbox/items/{itemId}/summary` and
`POST /v1/inbox/items/{itemId}/draft` for explicit AI generation. If the UI
invokes them, keep the request user-visible and use the same origin gate and
failure states. Do not treat a timeout as an empty summary or draft.

## Visible review, confirmation, and send

Real send must remain a deliberate App flow:

1. Fetch and display the current item and draft.
2. Let the user inspect/edit the complete final draft.
3. Visibly show the provider, conversation, and human-readable reply targets.
4. Require an explicit final-review action.
5. Request a short-lived confirmation.
6. Send that exact draft version once.

Request confirmation only after the visible final review:

```text
POST /v1/inbox/drafts/{draftId}/confirmation
```

The response contains `confirmation_token` and `expires_at`. Keep the token
only in memory and associate it with the current App session and reviewed
draft version. If the draft changes, the App session changes, or confirmation
expires, discard the token and require another visible review.

Send with:

```text
POST /v1/inbox/drafts/{draftId}:send
Idempotency-Key: <fresh high-entropy key for this user send action>
```

Example body:

```json
{
  "schema_version": "1.0",
  "request_id": "<same value as X-Request-ID>",
  "expected_version": 3,
  "confirmation_token": "<one-time confirmation token>"
}
```

The `expected_version` must equal the reviewed draft version. Generate one
fresh idempotency key for the single user send action and keep it only long
enough to correlate that action's result. Never reuse a key for a different
draft/version or a second user action.

There is no CLI send fallback for the Demo. Only the API-connected App may
request confirmation and send after the user has reviewed the exact version.

## Send result and retry policy

Handle response status explicitly:

- `sent`: show success only when the API returns `status=sent`.
- `failed`: show an explicit failure. A new attempt requires a new user
  decision, current draft fetch, visible review, confirmation, and key.
- `unknown`: show an ambiguous outcome and tell the operator to verify the
  provider conversation manually.
- Transport interruption or an unreadable response after send began: treat
  as ambiguous, equivalent to `unknown`.

Never automatically retry an ambiguous send, never issue a new idempotency key
for it, and never label it failed merely because the client timed out. Direct
retry could send a duplicate real message.

## Required UI states

Real mode must distinguish:

- initial loading and refresh
- genuinely empty list after a ready sync
- provider degraded, unavailable, or readiness unknown
- AI summary/draft generation timeout or unavailability
- stale item revision and stale draft version conflict
- confirmation expired, invalid, or bound to another App session
- explicit send failure
- ambiguous/unknown send result
- authentication, contract-version, and origin errors

Do not let loading, errors, or background refresh resize or replace controls
in a way that can cause an accidental acknowledgement or send. Disable the
send action while a request is in progress and after any ambiguous result.

## Implementation sequence

Keep the change scoped to the Apple Unified Inbox feature:

1. Preserve `UnifiedInboxDemoStore` and the current Fixture Sample Mode.
2. Add Codable transport models that match `contracts/openapi.yaml` and the
   referenced Inbox schemas.
3. Add a small API client using the existing App networking conventions and
   the separate, narrowly validated Unified Inbox integration configuration.
4. Add a real API-backed observable store with explicit origin and UI state.
5. Add the runtime secure-token entry/injection and in-memory lifecycle.
6. Coordinate the narrow Apple-owned local-network/ATS configuration needed
   for macOS loopback and iOS trusted-LAN access.
7. Add focused client/store tests, then run the existing Sample Mode tests.

Do not invent a second contract or expose raw backend models directly to
unrelated UI modules. If generated OpenAPI clients already exist in the Apple
target, extend that established path instead.

## Acceptance checklist

Record no private content, raw JSON, provider IDs, tokens, or sensitive
screenshots while checking these items:

- [ ] Existing Sample Mode Fixture list/detail/edit/simulated-send regression
      passes and remains visibly Sample/Demo.
- [ ] macOS loopback real list and detail work with
      `X-Hush-Data-Origin: real`.
- [ ] iOS trusted-LAN real list and detail work with
      `X-Hush-Data-Origin: real`.
- [ ] The App cannot confuse or silently switch between real and mock origin.
- [ ] `cached` is visibly stale and cannot satisfy real Demo PASS.
- [ ] Pagination consumes `next_cursor` or visibly reports truncation.
- [ ] Provider unavailable/degraded and genuinely empty states are distinct.
- [ ] Exact displayed digest revision is used for acknowledgement.
- [ ] A stale acknowledgement refreshes and requires review of the new
      revision.
- [ ] Draft edits use the displayed `expected_version`.
- [ ] A stale draft edit produces a refresh/review UI instead of overwriting.
- [ ] Provider, conversation, final draft, and reply targets are visible
      before confirmation.
- [ ] Confirmation expiry or App-session change requires reconfirmation.
- [ ] Send uses the reviewed version, one-time token, and a fresh idempotency
      key.
- [ ] Explicit failed and ambiguous unknown sends have different UI states.
- [ ] An ambiguous send is never automatically retried.
- [ ] No provider credentials, provider IDs, private participant IDs, or Hush
      tokens appear in UI or logs.
- [ ] `HUSH_APP_TOKEN` is runtime-supplied, memory-only, and cleared on real
      mode/base-URL change and relaunch.
- [ ] Native macOS/iOS HTTP transport works only for the approved loopback or
      trusted-LAN integration address; the existing cloud HTTPS boundary is
      unchanged.

Backend read validation may pass before this checklist. Full Demo PASS requires
the API-connected App to pass the applicable macOS/iOS UI and guarded-send
checks in `docs/feishu-dingtalk-real-validation/README.md`.
