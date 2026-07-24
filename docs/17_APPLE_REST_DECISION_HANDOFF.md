# Apple Rest Decision HTTPS Handoff

Status: phase 1 protocol and HTTPS deployment readiness are complete. The
actual HTTPS staging URL has not been created, and Apple iPhone/Mac device
verification remains manual.
Owner: W1 / P2 -> Apple Owner

## Runtime matrix

| Request | `trigger_source` | Continuous field | Estimated |
|---|---|---|---:|
| iOS App | `device_activity_threshold` | `estimated_continuous_app_usage_minutes` | true |
| Mac App | `macos_usage_checkpoint` | `continuous_app_usage_minutes` | false |
| Mac website | `macos_website_checkpoint` | `continuous_usage_minutes` | false |
| Legacy | legacy trigger, including deprecated `macos_rule` | `continuous_screen_minutes` | false |

`macos_rules` is not a Contract value. Current Apple code does not send
deprecated `macos_rule`. Current and legacy usage fields are mutually
exclusive.

The three current shapes normalize to one Provider context:

```text
source: platform + triggerSource + app|website
monitoredContext: user label + label source + hostname + privacy flags
usage: dailyMinutes + continuousMinutes + continuousIsEstimated
```

Estimated iOS continuous usage must not be described as exact foreground
time. No raw App identity, full URL, URL path/query, search term, or page
title is available to the Provider.

## HTTP behavior

| Result | Apple behavior |
|---|---|
| `200`, `should_offer_rest=true` | Apple may notify or apply Shield according to local settings |
| `200`, `should_offer_rest=false` | Do not create a new reminder; continue observing |
| `400` | Do not remind; malformed/unknown/mixed fields, unsafe privacy flag, or Header/body ID mismatch |
| `403` | Do not remind; supplied Demo Token is disabled or invalid |
| `409` | Do not remind; unsupported Contract version or request ID reused with different content |
| `503` | Do not remind; Provider unavailable and body is ErrorResponse, never RestSuggestion |

For `/v1/rest/evaluate`, the Header `X-Request-ID` must equal
`body.request_id`. An identical retry with the same ID and content returns
the stored compatible decision. Reusing the ID with different content returns
`409 INVALID_REQUEST` with `details.reason=REQUEST_ID_REUSED`.

The backend never activates Shield and never returns or changes the next
checkpoint.

## Hostname rules

- trim and lowercase the hostname;
- remove one leading `www.`;
- keep `m.`, `music.`, and all other subdomains distinct;
- reject scheme, path, query, fragment, userinfo, port, empty labels, and
  invalid DNS label syntax;
- `label_source=user` requires a non-empty user label;
- `label_source=domain` accepts an omitted or explicit-null user label and
  rejects a non-null user label;
- do not perform eTLD+1 or registrable-domain merging.

## HTTPS client contract

Apple configures the platform-provided root HTTPS Base URL:

```text
https://<deployed-origin>
```

The Base URL does not include `/v1/rest/evaluate`; current Swift clients append
that path. Current iOS DeviceActivity, Mac App, and Mac website clients reject
non-HTTPS URLs. Localhost and trusted-LAN HTTP are only for backend and manual
smoke tools, not current Apple client configuration.

Normal graph requests do not send `X-Hush-Demo-Token`. Keep:

```text
Content-Type: application/json
X-Request-ID: <same as body request_id>
X-Client-Version: <Apple app version>
X-Contract-Version: 1.0
```

Keep the current Swift timeout of 5 seconds. On `200 true`, Apple decides
whether to notify or apply Shield. On `200 false`, `400`, `403`, `409`, `503`,
timeout, malformed JSON, or response Contract mismatch, Apple creates no new
reminder. The backend does not control Shield and does not modify the next
checkpoint.

Canned staging returns `X-Hush-Data-Origin: mock`; it is not a Real Agent.
The HTTPS staging URL remains pending.

## Configuration

Local defaults:

```text
HOST=127.0.0.1
PORT=3000
NODE_ENV=development
PUBLIC_BASE_URL=http://localhost:3000
TRUST_PROXY=false
HUSH_DEMO_MODE=false
HUSH_DEMO_TOKEN=
HUSH_REST_DECISION_PROVIDER=canned
```

Cloud staging:

```text
HOST=0.0.0.0
PORT=<platform-supplied>
NODE_ENV=production
PUBLIC_BASE_URL=https://<deployed-origin>
TRUST_PROXY=true
HUSH_DEMO_MODE=false
HUSH_REST_DECISION_PROVIDER=canned
```

Production requires an explicit public HTTPS `PUBLIC_BASE_URL`. Normal does
not need a Demo Token. Set `HUSH_REST_DECISION_PROVIDER=unavailable` only for
the immediate 503 failure-injection path; it does not call a network service.
Normal Canned and Demo Canned both report origin `mock`.

Demo is selected only when server configuration and request Header all match:

```text
HUSH_DEMO_MODE=true
HUSH_DEMO_TOKEN=<at least 8 characters>
X-Hush-Demo-Token=<matching runtime value>
```

No token selects Normal even when Demo is enabled. Do not commit or print the
runtime token.

## Start and health

With the repository-standard Node 20.19.5 and pnpm 9.15.9 toolchain:

```powershell
Set-Location .\server
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
$env:HUSH_REST_DECISION_PROVIDER = "canned"
pnpm dev
```

Local health:

```powershell
curl.exe -i http://127.0.0.1:3000/v1/health
```

HTTPS staging health:

```bash
BASE_URL="https://<deployed-origin>"
curl -i "$BASE_URL/v1/health"
```

Apple receives only the root Base URL and does not add an API path during
configuration. Swift appends the endpoint path. The actual staging URL is
pending. A trusted-LAN HTTP address such as
`http://<windows-lan-ipv4>:3000` is only for manual smoke.

## curl examples

Run from the repository root. Each fixture request ID matches its Header.
These examples exercise the local manual harness; replace
`http://127.0.0.1:3000` with `https://<deployed-origin>` to run the same
fixture request against staging.

### iOS App (Canned false)

```powershell
curl.exe -i -X POST http://127.0.0.1:3000/v1/rest/evaluate `
  -H "Content-Type: application/json" `
  -H "X-Request-ID: req_usage_ios_current_001" `
  -H "X-Client-Version: 1.0.0-smoke" `
  -H "X-Contract-Version: 1.0" `
  --data-binary "@contracts/fixtures/usage-summary-device-activity-ios.json"
```

### Mac App (Canned true)

```powershell
curl.exe -i -X POST http://127.0.0.1:3000/v1/rest/evaluate `
  -H "Content-Type: application/json" `
  -H "X-Request-ID: req_usage_macos_app_001" `
  -H "X-Client-Version: 1.0.0-smoke" `
  -H "X-Contract-Version: 1.0" `
  --data-binary "@contracts/fixtures/usage-summary-macos-app.json"
```

### Mac website

```powershell
curl.exe -i -X POST http://127.0.0.1:3000/v1/rest/evaluate `
  -H "Content-Type: application/json" `
  -H "X-Request-ID: req_usage_macos_website_user_001" `
  -H "X-Client-Version: 1.0.0-smoke" `
  -H "X-Contract-Version: 1.0" `
  --data-binary "@contracts/fixtures/usage-summary-macos-website-user-label.json"
```

### Demo

Only after enabling Demo with a private runtime value, add:

```powershell
-H "X-Hush-Demo-Token: <private-runtime-token>"
```

### Provider unavailable (503)

Restart locally or redeploy staging with:

```powershell
$env:HUSH_REST_DECISION_PROVIDER = "unavailable"
pnpm dev
```

Repeat the iOS request. Expected: HTTP 503, the three Contract response
headers, and ErrorResponse `details.reason` equal to
`REST_DECISION_PROVIDER_UNAVAILABLE`; no `should_offer_rest` field. Restore
`canned` afterward.

## PowerShell smoke

Local protocol smoke:

```powershell
.\scripts\smoke-apple-rest-decision.ps1 `
  -BaseUrl "http://127.0.0.1:3000" `
  -Mode Normal `
  -Payload All
```

Optional local Demo:

```powershell
.\scripts\smoke-apple-rest-decision.ps1 `
  -BaseUrl "http://127.0.0.1:3000" `
  -Mode Demo `
  -DemoToken "<private-runtime-token>" `
  -Payload All
```

HTTPS staging:

```powershell
.\scripts\smoke-https-staging.ps1 `
  -BaseUrl "https://<deployed-origin>" `
  -Mode Https `
  -ExpectedDataOrigin mock
```

The HTTPS smoke validates health, all three Payload types, HTTP status,
Content-Type, `X-Request-ID`, `X-Contract-Version`,
`X-Hush-Data-Origin`, `response.request_id`, `should_offer_rest`, and message
type. It exits non-zero on mismatch or timeout and does not print the Demo
Token or complete user Payload.

## Apple handoff

The Apple Owner must:

1. set the platform-provided root HTTPS Base URL;
2. keep the current Headers and Header/body request ID equality;
3. keep the 5-second timeout;
4. verify true, false, 503, timeout, and malformed JSON behavior;
5. keep notification and Shield decisions Apple-owned for true;
6. create no new reminder for false or any error;
7. leave the confirmed Swift Payload and Codable models unchanged;
8. omit the Demo Token for Normal.

## Manual remaining checks

1. Create Render or an equivalent cloud service.
2. Obtain the real HTTPS staging URL.
3. Run `/v1/health` against staging.
4. Run all three checkpoint types against staging.
5. Verify true, false, 503, timeout, and malformed JSON on iPhone and Mac.
6. Confirm notifications and Shield remain entirely Apple-controlled.
7. Run standard CI with Node 20.19.5 and pnpm 9.15.9.
8. When Docker daemon is available, verify build, health, and SIGTERM.
9. Integrate a Real Rest Decision Provider in a separate task.
10. Add production client authentication, abuse protection, and rate limiting
    only through a later Contract Change.
