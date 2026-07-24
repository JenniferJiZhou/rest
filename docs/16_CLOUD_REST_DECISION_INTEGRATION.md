# Cloud Rest Decision Integration

Status: Contract Change, phase 1 foundation  
Owner: W1 / P2

## Scope

`POST /v1/rest/evaluate` now runs one explicit request execution pipeline:

```text
received
→ contract_validating
→ semantic_validating
→ normalizing
→ policy_precheck
→ provider_deciding
→ output_validating
→ quest_resolving
→ offer | no_offer
→ responded
```

Invalid requests end in `rejected`. Infrastructure failure ends in
`provider_unavailable` and returns HTTP 503; it is not disguised as a normal
`should_offer_rest=false` decision. Intermediate states are in-memory only.

## Accepted request formats

The UsageSummary JSON Schema defines four mutually exclusive shapes:

1. current iOS/iPadOS App (`device_activity_threshold`);
2. current Mac App (`macos_usage_checkpoint`);
3. current Mac website (`macos_website_checkpoint`);
4. legacy `continuous_screen_minutes`.

`macos_rule` remains accepted only for legacy compatibility and is
deprecated. `macos_rules` is not accepted.

Current fields and `continuous_screen_minutes` must never appear together.
The route returns `400 INVALID_REQUEST` on conflict.

For all current formats, continuous usage must not exceed daily usage.
iOS DeviceActivity must mark continuous usage as estimated. Mac App and Mac
website checkpoints must mark it as non-estimated.

## Website hostname boundary

`website_domain` is a hostname, not a URL:

- lowercase on normalization;
- remove one leading `www.`;
- preserve other subdomains;
- do not derive eTLD+1 or registrable domain;
- reject scheme, path, query, fragment, userinfo, and port;
- require `full_url_included=false`;
- require `page_title_included=false`.

Therefore:

```text
www.youtube.com   → youtube.com
youtube.com       → youtube.com
m.youtube.com     → m.youtube.com
music.youtube.com → music.youtube.com
```

## Provider-neutral context

Raw HTTP JSON is parsed and normalized before it reaches a Provider. The
Provider receives `RestDecisionContext`, including normalized usage,
user-supplied scope metadata, recent feedback, and explicit output
constraints. It never receives an unstructured prompt made from raw JSON.

The normalized groups are `source`, `monitoredContext`, and `usage`.
`usage.continuousIsEstimated` preserves the iOS estimate boundary. Website
domain labels accept an omitted or explicit-null user label.

The user label is trimmed and NFC-normalized. It is not an Apple-verified App
identity. Ordinary request/error logs contain request ID and error metadata,
not the raw label.

## Phase 1 Providers

| Graph | Provider | Origin | Network |
|---|---|---|---|
| Normal default | `CannedRestDecisionProvider` | `mock` | none |
| Demo | independent `CannedRestDecisionProvider` | `mock` | none |
| Failure test/explicit override | `UnavailableRestDecisionProvider` | `mock` | none |

No Claude, OpenAI, DeepSeek, or other real model is called for Rest
Decision in this phase. Existing AgentLLM use by check-in, quest selection,
and Handoff is unchanged.

For local failure verification,
`HUSH_REST_DECISION_PROVIDER=unavailable` selects the Unavailable Provider;
the safe default remains `canned`.

## Checkpoint idempotency

`request_id` is the idempotency key for `/v1/rest/evaluate`. The service uses
the shared `IdempotencyStore` boundary:

- same ID and same normalized request returns the stored decision;
- same ID and different content returns HTTP 409;
- failed Provider calls are not cached.

## Output Guard

Provider candidates are never returned directly. The server:

- generates `schema_version`;
- copies the verified request ID;
- generates the Contract-compatible actions;
- validates reason code and the 240-character message limit;
- resolves Quest IDs through the fixed repository;
- rejects medical diagnosis, raw App identity claims, exact claims about
  estimated continuous usage, and device/threshold control commands.

An offered result includes only a fixed-library Quest ID. A no-offer result
uses an empty message, null Quest ID, and `dismiss`.

## Failure response

Provider unavailable:

```http
HTTP/1.1 503
X-Request-ID: req_example
X-Contract-Version: 1.0
X-Hush-Data-Origin: mock
```

```json
{
  "schema_version": "1.0",
  "request_id": "req_example",
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "休息建议服务暂时不可用。",
    "retryable": true,
    "fallback": "LOCAL_RULES",
    "details": {
      "reason": "REST_DECISION_PROVIDER_UNAVAILABLE"
    }
  }
}
```

The backend does not send a notification, activate Shield, close an App, or
change a usage threshold.
