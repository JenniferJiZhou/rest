# Dynamic Rest Task Contract 1.1

Status: W1 local closeout complete; review, credentialed staging, Apple builds,
and device acceptance remain external validation
Owners/reviewers: W1 / P2, M1 / P1, M2 / P4
Prompt versions: `dynamic-rest-decision-v1.1`,
`dynamic-manual-rest-v1.1`

## Product Owner authorization

The Product Owner task card explicitly authorizes this Contract Change from
“model selects a fixed `quest_id`” to “StepFun evaluates current work behavior
and generates a dynamic rest task.” The latest Product Owner decision covers
both proactive Mode A and user-initiated Mode B. Fatigue reflection (Mode C),
Guided Drift, Blue Reset, Contract 1.0, and other legacy fixed-content flows
keep their existing behavior.

The same decision authorizes minimum technical parsing for dynamic tasks:
valid JSON, required fields, correct types, and the true/object versus
false/null relationship. It does not authorize semantic task filters, dynamic
Quest allowlists, device control, notification control, Shield/Lockdown
control, checkpoint changes, or external messaging.

## Scope and compatibility

`POST /v1/rest/evaluate` and `POST /v1/rest/recommend` negotiate both
`X-Contract-Version: 1.0` and `1.1`. All other routes remain Contract 1.0.

- 1.0 keeps cooldown, the short legacy model budget, fixed Quest resolution,
  `default_quest_id`, and existing Output Guards.
- 1.1 always calls the selected dynamic Provider, including when
  `minutes_since_last_rest < 15`; it never reads the Quest Repository.
- Recommend 1.0 keeps `content_version`, allowed/excluded IDs, and fixed
  `quest_id` selection. Recommend 1.1 omits those fields, does not repeat a
  `shouldOfferRest` decision, and returns one `generated_task`.
- A 1.1 failure returns a 1.1 ErrorResponse and never falls back to a 1.0
  Quest.
- Idempotency keys include the negotiated Contract version, so the same
  request ID cannot confuse 1.0 and 1.1 results.

## Response invariant

For Mode A `should_offer_rest=true`, `generated_task` is an object and the
server-owned actions are `start_rest_session`, `remind_later`, and `dismiss`.
For `false`, `generated_task` is null and actions are empty. The wire Contract
allows any string message, while Mode A's Prompt and Canned implementation
produce a non-empty companion message. In both branches `default_quest_id` is
required, deprecated, and null. Mode B has no `should_offer_rest` field; its
`generated_task` is always an object, actions are the same three server-owned
values, and `default_quest_id` is also required and null.

`generated_task` has structural validation only:

```json
{
  "title": "一分钟桌边重置",
  "duration_seconds": 60,
  "steps": [
    "暂时让双手离开键盘",
    "看向比屏幕更远的位置",
    "肩膀放松后再回来"
  ]
}
```

There are deliberately no title/step length rules, duration range rules,
keyword filters, content scores, or fixed-task allowlists on the 1.1 path.

## Mode Router

The caller chooses a mode; the model cannot change it.

| Mode | Prompt / Schema | Content source |
|---|---|---|
| `work_state_or_rest_decision` | `dynamic-rest-decision-v1.1` | StepFun dynamic task or companion message |
| `manual_rest_quest` | `dynamic-manual-rest-v1.1` | StepFun dynamic task; the user has already chosen rest |
| `fatigue_reflection` | `fatigue-reflection-v1.0` | existing reflection schema |

Mode A sends the normalized platform, trigger, target, user label/domain,
daily and continuous usage, estimation flag, recent switching, local hour,
last-rest interval, reported energy, and feedback. It does not send allowed
Quest IDs. The Prompt prohibits device, notification, Shield, Lockdown,
checkpoint, email, messaging, or tool control.

Mode B sends only session, fatigue type, preference, available time, source,
and location tags. It sends no content version, allowed/excluded Quest IDs,
or Quest Repository data. Contract 1.0 retains its legacy fixed-library
prompt outside the three-mode 1.1 router.

## StepFun adapter

The provider-neutral dynamic `RestDecisionProvider` uses the built-in
`fetch` adapter:

```text
POST <STEPFUN_BASE_URL>/chat/completions
Authorization: Bearer <STEPFUN_API_KEY>
```

It is non-streaming and sends the selected system Prompt, the Router's actual
serialized output JSON Schema, an exact-camelCase instruction, and the
serialized provider-neutral input as `messages`, with
`response_format.type=json_object`. Mode A and Mode B therefore receive their
distinct schemas without assuming provider-side strict-schema support. The
schema is not logged or returned to clients. The adapter reads only
`choices[0].message.content`; the server then parses JSON and validates the
mode-specific structure. It does not assume strict JSON Schema support in
the configured model. Raw provider bodies never cross into the application
layer. AbortSignal covers the configured transport timeout and HTTP client
disconnect.

Configuration:

```text
STEPFUN_API_KEY=<secret>
STEPFUN_BASE_URL=https://api.stepfun.com/v1
STEPFUN_MODEL=<explicit account-enabled model>
STEPFUN_TIMEOUT_MS=30000
```

The model is intentionally not defaulted in code. `step-3.7-flash` in
`.env.example` is an example, not a statement of account availability.
Incomplete real configuration selects Unavailable; Canned/Demo remain
isolated Mock graphs. Tests use stubs and never call StepFun.

`GET /v1/health` performs no Provider network call. It reports only the
provider-neutral `providers.rest_decision` value `ready` or `unavailable`;
it does not reveal a key, model, full base URL, provider error body, or quota.

## Apple mapping

Upgraded iOS DeviceActivity, Mac App, and Mac website clients send
`X-Contract-Version: 1.1` with a 35-second request/resource timeout, longer
than the backend's default 30 seconds.

The Swift mirror is:

```swift
struct GeneratedRestTask: Codable {
    let title: String
    let durationSeconds: Int
    let steps: [String]
}
```

The shared manual-rest client posts Contract 1.1 to
`/v1/rest/recommend`, validates the echoed version/request ID and exact
server-owned actions, then uses the same `GeneratedRestTask` Codable and
existing session timer. A missing configuration, 503, timeout, or malformed
response returns to the usable home state and never substitutes a fixed
Quest.

On false, clients retain the companion message without notifying, opening a
task, applying Shield/Lockdown, or changing a checkpoint. On true, existing
notification userInfo carries title, duration, and ordered steps; opening it
shows the wave home and temporary generated task. The task is converted only
to the existing display/session value type; it is never looked up by
`default_quest_id`. The duration initializes the existing timer.

During a Mac request the wave home may show “Hush 正在为此刻留出一点空间……”.
Every success, HTTP error, timeout, decode failure, or cancellation ends that
state. Failures show no raw model/JSON error, create no notification, and do
not substitute a fixed Quest.

No Signing, Bundle ID, Entitlement, Capability, App Group, Target, or
`Hush.xcodeproj` change is part of this Contract Change.

## Verification

From `server/` with Node 20.19.x and pnpm 9.x:

```powershell
corepack pnpm typecheck
corepack pnpm test:contracts
corepack pnpm test:providers
corepack pnpm test:integration
corepack pnpm test:vertical
corepack pnpm test
corepack pnpm build
corepack pnpm check
```

Dedicated Contract 1.1 smoke (the script makes no request without an explicit
Base URL and permits HTTP only on loopback):

```powershell
.\scripts\smoke-dynamic-rest-decision.ps1 `
  -BaseUrl "http://127.0.0.1:3000" `
  -ExpectedDataOrigin mock `
  -FixtureMode All
```

Unavailable failure injection:

```powershell
.\scripts\smoke-dynamic-rest-decision.ps1 `
  -BaseUrl "http://127.0.0.1:3000" `
  -ExpectedDataOrigin mock `
  -ExpectProviderUnavailable `
  -FixtureMode Offer
```

Credentialed HTTPS staging, only after an operator supplies the deployed
origin:

```powershell
.\scripts\smoke-dynamic-rest-decision.ps1 `
  -BaseUrl "https://<deployed-origin>" `
  -ExpectedDataOrigin real `
  -FixtureMode All
```

The script reads no StepFun key and prints neither full request data nor raw
Provider responses. It validates health, Contract/header/request ID echoes,
data origin, Mode A true/object, Mode A false/null, Mode B generated task,
deprecated-null Quest, actions, and versioned 503 ErrorResponses.

## Deployment handoff

1. Run the full server verification suite with Node 20.19.x and pnpm 9.15.9.
2. Configure the existing HTTPS deployment with
   `HUSH_REST_DECISION_PROVIDER=real`, `STEPFUN_API_KEY`,
   `STEPFUN_BASE_URL`, `STEPFUN_MODEL`, and
   `STEPFUN_TIMEOUT_MS=30000`. Store the key only in the platform secret
   manager.
3. Confirm `/v1/health` reports only `ready`; it must not reveal the Provider,
   model, base URL, key, or upstream error.
4. Run the dedicated HTTPS smoke with the deployed origin and expected
   `real` data origin.
5. Separately run the `unavailable` failure-injection smoke, then restore the
   real configuration.
6. Give M1/M2 the approved HTTPS root and complete the Apple build/device
   matrix below.

No credentialed StepFun call or Contract 1.1 deployment was performed during
W1 local closeout.

## M1/M2 Apple handoff

Apple Owner verification on macOS:

```bash
xcodebuild -project apps/HushApp/Hush.xcodeproj \
  -scheme Hush -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build
xcodebuild -project apps/HushApp/Hush.xcodeproj \
  -scheme HushMac -configuration Debug build
xcodebuild -project apps/HushApp/Hush.xcodeproj \
  -scheme HushDeviceActivityMonitor -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build
```

The three scheme names above are present in
`Hush.xcodeproj/xcshareddata/xcschemes`. Windows static review cannot run
these commands.

| Surface / case | Required observation | Failure condition |
|---|---|---|
| iOS DeviceActivity, true | generating ends; one notification; tap opens the dynamic title, ordered steps, and model duration | fixed Quest lookup, missing/reordered steps, or wrong timer |
| iOS DeviceActivity, false | no notification; App Group companion appears on the always-on page | notification/task/Shield/Lockdown appears |
| iOS DeviceActivity, 503/timeout/malformed | generating ends; no task or fixed fallback | stuck generating or notification |
| Mac App, true | notification opens dynamic content; timer uses `duration_seconds`; remind later/dismiss work | fixed Quest or firm interruption |
| Mac App, false | no notification; companion updates on the wave home | task opens because message is non-empty |
| Mac Website, true/false | same branch behavior as Mac App with website context | branch behavior differs from Mac App |
| iOS/Mac manual rest | `/v1/rest/recommend` 1.1 returns a generated title, ordered steps, and model duration | local Quest lookup, `quest_id`, or fixed fallback |
| All surfaces | existing checkpoint cadence and monitoring limits remain unchanged | new/changed checkpoint or automatic Shield/Lockdown |

Success means all three Debug builds pass and every row matches the required
observation on the applicable simulator/device. Any build failure, stuck
generating state, true/object or false/null mismatch, fixed-Quest fallback,
unexpected notification, Shield/Lockdown application, or checkpoint change is
a failure and must return to W1/M1/M2 review.

## Review and incomplete items

- W1/P2: Contract/OpenAPI/Zod/fixtures, Router, StepFun adapter, errors,
  composition, smoke, and server tests.
- M1/P1: shared/iOS Codable, notification/App Group/UI chain, ordered steps,
  timer, and iOS/Extension builds.
- M2/P4: Mac App and website request/UI paths, notification handoff, companion
  state, and Mac build.
- Still external: real account-enabled StepFun model verification, deployed
  HTTPS smoke, Zeabur configuration, Apple Debug builds, and real-device
  acceptance.
