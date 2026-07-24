# Apple Rest Decision HTTPS Handoff

Status: Canned staging ready; HTTPS staging URL pending.  
Owner: W1 / P2 -> Apple Owner

## Client contract

- Configure the platform-provided root HTTPS Base URL, without an API path.
  Current Swift code appends `/v1/rest/evaluate`.
- Normal graph requests do not send `X-Hush-Demo-Token`.
- Keep `X-Request-ID`, `X-Client-Version`, and
  `X-Contract-Version: 1.0`; body `request_id` must echo the first header.
- Keep the current Swift request timeout of 5 seconds.
- `200 should_offer_rest=true`: Apple decides whether to notify or apply a
  Shield.
- `200 should_offer_rest=false`: Apple creates no new reminder.
- `400`, `403`, `409`, `503`, timeout, malformed JSON, or response Contract
  mismatch: Apple creates no new reminder and keeps the local safe path.
- The backend does not return the next checkpoint and never controls Shield.
- `X-Hush-Data-Origin: mock` is expected from Canned staging. Canned is not a
  Real Agent; Real Provider integration is a later task.

Set:

```bash
BASE_URL="https://<deployed-origin>"
CLIENT_VERSION="1.0.0"
```

Health:

```bash
curl -i "$BASE_URL/v1/health"
```

## Three Apple payloads

iOS App:

```bash
REQUEST_ID="req_https_ios"
curl -i -X POST "$BASE_URL/v1/rest/evaluate" \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: $REQUEST_ID" \
  -H "X-Client-Version: $CLIENT_VERSION" \
  -H "X-Contract-Version: 1.0" \
  -d '{"schema_version":"1.0","request_id":"req_https_ios","measured_at":"2026-07-24T04:00:00Z","platform":"ios","trigger_source":"device_activity_threshold","user_provided_context_label":"Writing","daily_app_usage_minutes":35,"estimated_continuous_app_usage_minutes":30,"continuous_usage_is_estimated":true,"app_switches_last_10_minutes":null,"local_hour":14,"minutes_since_last_rest":180,"self_reported_energy":null,"recent_feedback":[],"raw_app_names_included":false}'
```

Mac App:

```bash
REQUEST_ID="req_https_mac_app"
curl -i -X POST "$BASE_URL/v1/rest/evaluate" \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: $REQUEST_ID" \
  -H "X-Client-Version: $CLIENT_VERSION" \
  -H "X-Contract-Version: 1.0" \
  -d '{"schema_version":"1.0","request_id":"req_https_mac_app","measured_at":"2026-07-24T04:00:00Z","platform":"macos","trigger_source":"macos_usage_checkpoint","user_provided_context_label":"Writing","daily_app_usage_minutes":35,"continuous_app_usage_minutes":30,"continuous_usage_is_estimated":false,"app_switches_last_10_minutes":2,"local_hour":14,"minutes_since_last_rest":180,"self_reported_energy":null,"recent_feedback":[],"raw_app_names_included":false}'
```

Mac Website:

```bash
REQUEST_ID="req_https_mac_website"
curl -i -X POST "$BASE_URL/v1/rest/evaluate" \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: $REQUEST_ID" \
  -H "X-Client-Version: $CLIENT_VERSION" \
  -H "X-Contract-Version: 1.0" \
  -d '{"schema_version":"1.0","request_id":"req_https_mac_website","measured_at":"2026-07-24T04:00:00Z","platform":"macos","trigger_source":"macos_website_checkpoint","target_type":"website","website_domain":"example.com","label_source":"domain","daily_usage_minutes":35,"continuous_usage_minutes":30,"continuous_usage_is_estimated":false,"app_switches_last_10_minutes":2,"local_hour":14,"minutes_since_last_rest":180,"self_reported_energy":null,"recent_feedback":[],"full_url_included":false,"page_title_included":false}'
```

## False, true, 409, and 503

For a deterministic false result, use the iOS curl above with both usage
values set to `5`. For a true result, use `35` daily and `30` estimated
continuous minutes as shown.

To verify Contract rejection, send the same body with:

```bash
-H "X-Contract-Version: 0.9"
```

Expected: HTTP 409; Apple creates no reminder.

To verify Provider failure, the deployer temporarily sets:

```text
HUSH_REST_DECISION_PROVIDER=unavailable
```

Redeploy, run any of the three normal curls, and expect HTTP 503 with
`error.retryable=true`. Restore `canned` and redeploy afterward.

For every evaluate response verify:

```text
Content-Type: application/json
X-Request-ID: <exact request value>
X-Contract-Version: 1.0
X-Hush-Data-Origin: mock
response.request_id == X-Request-ID
```

No example contains a Demo Token or other secret. Use
`scripts/smoke-https-staging.ps1` for automated header and request-ID echo
verification.
