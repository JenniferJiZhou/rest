# Apple Client Integration Kit

Status: Contract v1 (`1.0`) frozen.  
Audience: M1/M2 Apple client developers and W1 integration owner.

This kit covers the W1 Rest and Handoff APIs. Gmail OAuth and Photon webhook
adapters are owned separately and are not required for Mock Server
integration.

## 1. Base URLs

| Environment | Base URL |
|---|---|
| Same Windows host | `http://127.0.0.1:3000` |
| Trusted LAN | `http://<windows-lan-ipv4>:<port>` |
| Demo | `https://<demo-host>` |

The Demo URL is a placeholder until deployment. Keep the base URL in client
configuration, not inside feature views.

An iPhone or a different Mac must not use `127.0.0.1`; that address points
back to the Apple device itself. See
`15_APPLE_MOCK_INTEGRATION_RELEASE.md` for LAN startup, firewall, ATS, and
local-network permission guidance.

## 2. Required headers

Every Rest and Handoff request requires:

```text
X-Request-ID: <new opaque id for this HTTP request>
X-Client-Version: <Apple app version>
X-Contract-Version: 1.0
```

Requests with JSON bodies must repeat the same value in `request_id`.

These operations also require an idempotency key:

```text
POST /v1/rest/feedback
POST /v1/handoff/start

Idempotency-Key: <stable 8–128 character key for this logical operation>
```

Sample Mode additionally uses:

```text
X-Hush-Demo-Token: <private runtime token>
```

Do not ship a production demo token in the repository or App binary.
`GET /v1/health` does not require client headers, but it returns the same
three Contract response headers.

Every Rest and Handoff response returns:

```text
X-Request-ID: <same request id>
X-Contract-Version: 1.0
X-Hush-Data-Origin: real | mock | cached
```

## 3. Sample Mode

Sample Mode is active only when both conditions are true:

1. server starts with `HUSH_DEMO_MODE=true` and `HUSH_DEMO_TOKEN` set;
2. request sends the matching `X-Hush-Demo-Token`.

Behavior:

- server disabled + token header: `403 DEMO_MODE_DISABLED`;
- server enabled + wrong token: `403 DEMO_MODE_DISABLED`;
- server enabled + no token: normal service graph; origin is graph-derived
  and may be `mock` when Canned/Noop/Console providers participate;
- server enabled + correct token: Mock service graph, origin `mock`.

The Apple UI must visibly label all `mock` responses as `SAMPLE MODE`.
Never infer Mock status only from local configuration; trust the response
header.

## 4. cURL examples

Shell variables used below:

```bash
BASE_URL="http://127.0.0.1:3000"
CLIENT_VERSION="0.1.0"
DEMO_TOKEN="<local-demo-token>"
```

Remove the demo-token header to exercise the normal graph. Do not infer that
it is fully real; trust `X-Hush-Data-Origin`.

### Health

```bash
curl "$BASE_URL/v1/health"
```

### Evaluate rest

```bash
REQUEST_ID="req_curl_evaluate"
curl -X POST "$BASE_URL/v1/rest/evaluate" \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: $REQUEST_ID" \
  -H "X-Client-Version: $CLIENT_VERSION" \
  -H "X-Contract-Version: 1.0" \
  -H "X-Hush-Demo-Token: $DEMO_TOKEN" \
  -d '{
    "schema_version":"1.0",
    "request_id":"req_curl_evaluate",
    "measured_at":"2026-07-24T15:20:00+08:00",
    "platform":"ios",
    "trigger_source":"manual_ios",
    "continuous_screen_minutes":null,
    "app_switches_last_10_minutes":null,
    "local_hour":15,
    "minutes_since_last_rest":96,
    "self_reported_energy":2,
    "recent_feedback":[],
    "raw_app_names_included":false
  }'
```

### First fatigue check-in

```bash
REQUEST_ID="req_curl_check_in_1"
curl -X POST "$BASE_URL/v1/rest/check-in" \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: $REQUEST_ID" \
  -H "X-Client-Version: $CLIENT_VERSION" \
  -H "X-Contract-Version: 1.0" \
  -H "X-Hush-Demo-Token: $DEMO_TOKEN" \
  -d '{
    "schema_version":"1.0",
    "request_id":"req_curl_check_in_1",
    "session_id":"session_curl",
    "source":"manual_ios",
    "description":"我说不清楚是哪一种累",
    "input_mode":"text",
    "available_minutes":3,
    "willing_to_move":null,
    "current_place":"desk",
    "follow_up_answer":null
  }'
```

If `needs_follow_up=true`, make one second request with a new Request ID and
the same `session_id`, adding `follow_up_answer`. The client must not initiate
a third follow-up.

### Recommend a fixed Quest

```bash
REQUEST_ID="req_curl_recommend"
curl -X POST "$BASE_URL/v1/rest/recommend" \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: $REQUEST_ID" \
  -H "X-Client-Version: $CLIENT_VERSION" \
  -H "X-Contract-Version: 1.0" \
  -H "X-Hush-Demo-Token: $DEMO_TOKEN" \
  -d '{
    "schema_version":"1.0",
    "request_id":"req_curl_recommend",
    "session_id":"session_curl",
    "content_version":"1.0.0",
    "fatigue_type":"cognitive_overload",
    "user_preference":"quiet",
    "available_minutes":3,
    "source":"ios_app",
    "location_tags":["any"],
    "excluded_quest_ids":[],
    "allowed_quest_ids":["look_far_01"]
  }'
```

The client renders the locally bundled Quest whose ID equals `quest_id`.
It must reject an unknown ID and use a local fallback; it must not render
steps supplied outside the fixed content bundle.

### Record feedback

```bash
REQUEST_ID="req_curl_feedback"
curl -X POST "$BASE_URL/v1/rest/feedback" \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: $REQUEST_ID" \
  -H "X-Client-Version: $CLIENT_VERSION" \
  -H "X-Contract-Version: 1.0" \
  -H "X-Hush-Demo-Token: $DEMO_TOKEN" \
  -H "Idempotency-Key: idem-curl-feedback" \
  -d '{
    "schema_version":"1.0",
    "request_id":"req_curl_feedback",
    "session_id":"session_curl",
    "quest_id":"look_far_01",
    "helpfulness":"helped",
    "timing":"right",
    "recorded_at":"2026-07-24T15:24:00+08:00",
    "notes":null
  }'
```

Success is `202` with an empty body.

### Start an Open Loops Only Handoff

```bash
REQUEST_ID="req_curl_handoff"
curl -X POST "$BASE_URL/v1/handoff/start" \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: $REQUEST_ID" \
  -H "X-Client-Version: $CLIENT_VERSION" \
  -H "X-Contract-Version: 1.0" \
  -H "X-Hush-Demo-Token: $DEMO_TOKEN" \
  -H "Idempotency-Key: idem-curl-handoff" \
  -d '{
    "schema_version":"1.0",
    "request_id":"req_curl_handoff",
    "source":"ios_app",
    "include_gmail":false,
    "gmail_account_id":null,
    "open_loops":[
      {
        "id":"ol_curl_1",
        "text":"明天先确认提交材料格式",
        "desired_time":"tomorrow_morning"
      },
      {
        "id":"ol_curl_2",
        "text":"检查首页深色模式按钮",
        "desired_time":"tomorrow"
      }
    ],
    "response_channel":"app",
    "timezone":"Asia/Shanghai",
    "locale":"zh-CN"
  }'
```

Retry this logical start only with the same body and the same
`Idempotency-Key`. The returned `job_id` must be reused.

### Poll a Handoff Job

```bash
REQUEST_ID="req_curl_poll_1"
JOB_ID="<job-id-from-start>"
curl "$BASE_URL/v1/handoff/$JOB_ID" \
  -H "X-Request-ID: $REQUEST_ID" \
  -H "X-Client-Version: $CLIENT_VERSION" \
  -H "X-Contract-Version: 1.0" \
  -H "X-Hush-Demo-Token: $DEMO_TOKEN"
```

Each poll gets a new Request ID. The returned summary's `request_id` echoes
that poll request; `job_id` is the stable correlation identifier.

### Cancel a Handoff Job

```bash
REQUEST_ID="req_curl_cancel"
JOB_ID="<job-id-from-start>"
curl -X POST "$BASE_URL/v1/handoff/$JOB_ID/cancel" \
  -H "X-Request-ID: $REQUEST_ID" \
  -H "X-Client-Version: $CLIENT_VERSION" \
  -H "X-Contract-Version: 1.0" \
  -H "X-Hush-Demo-Token: $DEMO_TOKEN"
```

Success is `202`. Poll until the state is `cancelled`.

## 5. Fixtures

Fixtures are contract examples, not a promise that unrelated input/output
files form one deterministic pair.

| Flow | Request-shape fixture | Response/state-shape fixture |
|---|---|---|
| Evaluate | `usage-summary-manual-ios.json` | `rest-suggestion-no-offer.json` |
| Check-in | `fatigue-check-in-cognitive.json` | `fatigue-reflection-follow-up.json` |
| Recommend | fields from `rest-recommendation-success.json` request examples | `rest-recommendation-success.json` |
| Start Handoff | `handoff-start-request.json` | `handoff-job-running.json` |
| Open Loops Only | `handoff-start-open-loops-no-gmail.json` | `handoff-job-succeeded-open-loops-only.json` |
| Handoff summary | start fixture above | `handoff-summary-open-loops-only.json` or `handoff-summary-success.json` |
| LLM failure | relevant request fixture | `error-llm-invalid-output.json` |
| Gmail unavailable | Handoff request with `include_gmail=true` | `handoff-job-failed-gmail.json` is an error-shape fixture; runtime currently degrades to successful Open Loops Only |

The canonical paths are `contracts/fixtures/` and
`contracts/schemas/`. Swift bundled copies must preserve exact enum spelling
and nullability.

Known frozen-fixture boundaries:

- request and response fixtures above are independently valid shape examples;
  several have different Request IDs and are not deterministic pairs;
- the current manual usage fixture produces an offered rest in the runtime,
  while `rest-suggestion-no-offer.json` demonstrates the no-offer shape;
- runtime `include_gmail=false` reports
  `authorized_gmail_not_requested`; the existing successful Open Loops fixture
  uses `authorized_gmail_unavailable`;
- `handoff-job-failed-gmail.json` remains a valid failed-state/error fixture,
  while the current application service degrades ordinary provider
  unavailability to successful Open Loops Only.

These Contract v1 fixtures were not silently rewritten by W1-04. Apple should
decode all schema-valid values, while integration assertions should follow
the live runtime rules described in this document.

## 6. Timeout, retry, and polling

| Endpoint | Client timeout |
|---|---:|
| `/v1/health` | 3 s |
| `/v1/rest/evaluate` | 8 s |
| `/v1/rest/check-in` | 12 s |
| `/v1/rest/recommend` | 8 s |
| `/v1/rest/feedback` | 5 s |
| `/v1/handoff/start` | 5 s |
| `/v1/handoff/{jobId}` | 5 s |

Retry:

- `GET`: retry network failures at most twice with 1 s / 2 s backoff;
- Rest `POST`: no automatic retry, except feedback may retry once with the
  same idempotency key;
- Handoff start: retry only with the same body and idempotency key;
- validation, authentication, and contract errors are not retryable.

Polling:

- poll every 2 seconds;
- stop on `succeeded`, `failed`, or `cancelled`;
- after 60 seconds, allow the user to rest while the Job continues;
- persist `job_id` so polling can resume after App restart.

## 7. Handoff Job states

`status`:

```text
queued | running | succeeded | failed | cancelled
```

`progress_stage`:

```text
queued
fetching_mail
classifying
creating_drafts
preparing_receipt
completed
failed
cancelled
```

Fast Jobs may move from the `queued` start response to `succeeded` between
two polls. A client must not require observing every running stage.

For a successful Open Loops Only Job:

- `summary` is present;
- `included_sources` includes `user_submitted_open_loops`;
- `excluded_sources` includes `authorized_gmail_not_requested`, or
  `authorized_gmail_unavailable` when Gmail was requested but unavailable;
- `held_items`, `tomorrow_first_step`, `conclusion`, and `coverage_note`
  come from the Pause Receipt.

Cancellation uses CAS plus a Job-scoped `AbortController`. The state becomes
`cancelled`, the active Agent/Mail/Draft call receives an aborted signal, and
late provider or timeout results cannot replace the terminal state. A
Completion delivery already following a persisted success can also be
aborted without reversing `succeeded`.

## 8. Error handling and fallback

All errors use:

```json
{
  "schema_version": "1.0",
  "request_id": "req_xxx",
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Safe user-facing message",
    "retryable": false,
    "fallback": null,
    "details": null
  }
}
```

| Code | Apple client action |
|---|---|
| `INVALID_REQUEST` | Do not retry; log Request ID and fix client payload |
| `CONTRACT_VERSION_UNSUPPORTED` | Stop real integration; use bundled local path |
| `CONTENT_VERSION_MISMATCH` | Use a local fixed Quest |
| `LLM_TIMEOUT` / `LLM_INVALID_OUTPUT` | Use local/canned reflection or Quest |
| `GMAIL_NOT_CONNECTED` / `GMAIL_UNAVAILABLE` | Continue Open Loops Only |
| `GMAIL_RATE_LIMITED` | Continue rest; offer delayed retry |
| `GMAIL_DRAFT_FAILED` | Show summary and mark draft as not saved |
| `PHOTON_UNAVAILABLE` | Complete the flow inside the App |
| `JOB_NOT_FOUND` | Remove stale Job ID and start again only after user action |
| `DEMO_MODE_DISABLED` | Do not imitate Sample Mode locally |
| `INTERNAL_ERROR` | Safe generic UI; attach Request ID to bug report |

Use both HTTP status and `error.code`; never branch on localized
`error.message`.

## 9. `X-Hush-Data-Origin`

| Value | Meaning | UI requirement |
|---|---|---|
| `real` | Every participating provider in the selected graph declares real origin | Normal UI |
| `mock` | Demo selected, or any Canned/Fixture/Recording/Noop/Console provider participates | Show `SAMPLE MODE` |
| `cached` | Previously verified result reused | Show stale/cached state when time-sensitive |

Treat an unknown or missing origin on a W1 response as a protocol failure.
Health also carries the data-origin header and conservatively reports `mock`
unless both normal Rest and Handoff graphs are fully real.

## 10. Swift enum and nullable checklist

Swift must reject unknown Contract v1 enum values and route to a safe local
fallback. Validate at least:

- fatigue type: `physical`, `sensory_overload`,
  `cognitive_overload`, `emotional_social`, `bedtime_arousal`, `unknown`;
- Job status and progress stages listed above;
- trigger source, platform, response channel, open-loop desired time;
- feedback helpfulness and timing;
- Pause Receipt held-item status;
- Handoff priorities represented by summary buckets, including
  `uncertain`.

Fields that are nullable or conditionally absent include:

- usage measurements and `self_reported_energy`;
- check-in movement/place/follow-up answer;
- reflection `follow_up` and `safety_notice`;
- recommendation preference, `intro`, and `fallback_quest_id`;
- open-loop desired time and Gmail account ID;
- Job `estimated_wait_seconds`, `summary`, and `error`;
- Pause Receipt `tomorrow_first_step`;
- Gmail draft ID and optional mail metadata.

Do not replace missing/`null` `summary` with an empty success model.

## 11. Mock Server-only integration

Start locally:

```powershell
cd server
$env:HUSH_DEMO_MODE = "true"
$env:HUSH_DEMO_TOKEN = "<private-local-token>"
pnpm dev
```

The Apple client then:

1. uses `http://<windows-lan-ipv4>:3000` from another machine, or
   `http://127.0.0.1:3000` only when the client runs on the server host;
2. sends the matching demo token;
3. displays `SAMPLE MODE` after observing origin `mock`;
4. uses Rest APIs normally;
5. starts Handoff with either Fixture Gmail or
   `include_gmail=false`;
6. polls the real in-process Job state machine.

This path uses real Fastify routes, application services, repositories, and
composition, while injecting `CannedAgentLLM` and local providers. It does
not require Gmail OAuth, Photon, or an Apple production entitlement.

Run the PowerShell smoke client from the repository root:

```powershell
.\scripts\smoke-w1-vertical-slice.ps1 `
  -BaseUrl "http://127.0.0.1:3000" `
  -DemoToken "<private-local-token>"
```

## 12. Cross-client troubleshooting with Request ID

For every HTTP call, the Apple client should log:

```text
request_id
method
path
HTTP status
X-Contract-Version
X-Hush-Data-Origin
job_id (when present)
error.code (when present)
```

Never log email content, open-loop text, auth headers, or the demo token.

When reporting an issue to W1, provide:

1. Request ID from the response header;
2. UTC/local timestamp;
3. method and path;
4. HTTP status and error code;
5. Job ID for Handoff;
6. data origin;
7. client version.

W1 can search structured server logs by Request ID. For asynchronous Handoff,
use Job ID to correlate start, processing, polling, and completion; each poll
still has its own Request ID.
