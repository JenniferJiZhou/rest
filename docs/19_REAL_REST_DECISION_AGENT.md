# Real Rest Decision Agent

Status: implementation ready for credentialed staging evaluation  
Owner: W1 / P2  
Prompt version: `rest-decision-v1.0`

## Responsibility

The Real Rest Decision Agent is one implementation of
`RestDecisionProvider`. It receives a validated, normalized
`RestDecisionContext` and may decide only:

- `shouldOfferRest`;
- one existing `reasonCode`;
- one short optional `message`;
- one `defaultQuestId` from the fixed server allowlist.

It does not control the Apple device, notifications, Shield, App or website
blocking, the next checkpoint, request IDs, response actions, idempotency,
HTTP status, Data Origin, authentication, or retry policy. The Apple client
retains presentation and device-control authority.

## Architecture

```text
UsageSummary Contract validation
→ semantic validation and normalization
→ deterministic cooldown precheck
→ RestDecisionProvider
→ strict candidate parse
→ Output Guard
→ fixed Quest resolution
→ server-built RestSuggestion
```

The model never receives the raw HTTP body. The server injects
`schema_version`, the verified `request_id`, and Contract-compatible
`actions` after model output has passed every guard.

## Prompt and input

The complete System Prompt lives in:

```text
server/src/agent/rest-decision/rest-decision-prompt.ts
```

The stable version constant is:

```text
REST_DECISION_PROMPT_VERSION=rest-decision-v1.0
```

The model input is JSON serialized from explicit normalized fields:

```json
{
  "promptVersion": "rest-decision-v1.0",
  "task": "decide_current_optional_rest_offer",
  "responseLocale": "zh-CN",
  "decisionContext": {
    "platform": "ios",
    "triggerSource": "device_activity_threshold",
    "targetType": "app",
    "monitoredContext": {
      "userProvidedLabel": "user data or null",
      "labelIsUserSupplied": true,
      "labelSource": "user",
      "websiteDomain": null,
      "rawAppIdentityAvailable": false,
      "fullUrlAvailable": false,
      "pageTitleAvailable": false
    },
    "usage": {
      "dailyMinutes": 60,
      "continuousMinutes": 35,
      "continuousIsEstimated": true
    },
    "appSwitchesLast10Minutes": 2,
    "localHour": 14,
    "minutesSinceLastRest": 180,
    "selfReportedEnergy": null,
    "recentFeedback": []
  },
  "constraints": {
    "maximumMessageCharacters": 240,
    "allowedReasonCodes": [],
    "allowedQuestIds": [],
    "mayControlDevice": false,
    "mayChangeNextThreshold": false,
    "mayCreateQuest": false
  }
}
```

`allowedReasonCodes` comes from the Contract-backed Zod enum.
`allowedQuestIds` comes from `RestContentRepository.quests()`. The Prompt
does not maintain a duplicate enum or Quest list.

User labels, domains, and feedback are untrusted data. They remain JSON
values and are never interpolated into the System Prompt. Request headers,
Demo tokens, API keys, full URLs, page titles, Bundle IDs, raw App identity,
and unknown HTTP fields are excluded.

## Estimated continuous usage

`continuousIsEstimated=true` means `continuousMinutes` is a checkpoint-derived
estimate, not exact foreground observation. The Prompt prohibits exact
claims, and the server Output Guard rejects messages that describe a numeric
estimated continuous duration as observed fact.

## Structured output

Anthropic is called with `output_config.format.type=json_schema`. No tools are
registered. The schema has `additionalProperties=false` and permits exactly:

```json
{
  "shouldOfferRest": true,
  "reasonCode": "long_continuous_use",
  "message": "如果方便，可以暂时离开屏幕休息一下。",
  "defaultQuestId": "look_far_01"
}
```

For no-offer output, `message` must be empty, `defaultQuestId` must be null,
and the reason must have existing no-offer semantics. For an offer, the
message must be non-empty and the Quest must be allowlisted. Markdown,
malformed JSON, extra fields, reasoning fields, server-owned actions,
invented reasons, and invented Quests are rejected.

## Output Guard

The model result is never returned directly. Structural schema validation,
reason allowlisting, Quest resolution, boolean/message/Quest consistency,
and server-owned response assembly are primary controls. Additional text
guards reject:

- medical or psychological diagnosis;
- shaming, punishment, moral failure, or productivity pressure;
- claims of raw App identity or unavailable surveillance;
- full URL claims;
- exact numeric claims about estimated continuous usage;
- Shield, App blocking, threshold, or next-checkpoint instructions.

Guard failure returns `503 LLM_INVALID_OUTPUT`. The server does not repair a
rejected candidate into a successful suggestion.

## Timeout and cancellation

`REST_DECISION_TIMEOUT_MS` defaults to 3500 and accepts 500–4500. The server
uses the shared provider timeout helper, passes an `AbortSignal` through the
Real Provider to the Anthropic SDK, clears timers in `finally`, and aborts on:

- the configured model budget;
- an upstream HTTP client disconnect.

A late result cannot replace timeout or cancellation. Failed calls are not
stored in the successful idempotency cache.

## Composition matrix

| Mode | Provider | Origin on success | Model network |
|---|---|---|---|
| Normal + complete `real` config | Real | `real` | Anthropic-compatible API only |
| Normal + incomplete `real` config | Unavailable | no success | none |
| Normal + explicit `canned` | Canned | `mock` | none |
| Demo + valid token | independent Canned | `mock` | none |
| Demo + invalid token | rejected before Provider | no success | none |
| Explicit `unavailable` | Unavailable | no success | none |

Real failure never falls back to Canned. Demo never reuses or calls the Real
Provider.

## Error behavior

| Failure | HTTP | Error code | Safe detail |
|---|---:|---|---|
| timeout | 503 | `LLM_TIMEOUT` | `timeout` |
| provider unavailable | 503 | `INTERNAL_ERROR` | `REST_DECISION_PROVIDER_UNAVAILABLE` |
| authentication | 503 | `INTERNAL_ERROR` | `authentication` |
| model configuration | 503 | `INTERNAL_ERROR` | `configuration` |
| malformed JSON | 503 | `LLM_INVALID_OUTPUT` | `invalid_json` |
| schema/allowlist/Guard rejection | 503 | `LLM_INVALID_OUTPUT` | sanitized classification |
| client cancellation | 503 if writable | `INTERNAL_ERROR` | `aborted` |

Error responses never contain the API key, Authorization header, complete
Prompt, complete model input/output, raw Provider response, user label, or
full domain context.

## Configuration

```text
HUSH_REST_DECISION_PROVIDER=real
CLAUDE_API_KEY=<secret>
CLAUDE_BASE_URL=https://api.anthropic.com
REST_DECISION_MODEL=<deployment-selected-model>
REST_DECISION_TIMEOUT_MS=3500
```

`REST_DECISION_MODEL` falls back to `CLAUDE_MODEL` when omitted. Do not place
the complete System Prompt in an environment variable. Do not commit
credentials.

For deterministic local and CI testing:

```text
HUSH_REST_DECISION_PROVIDER=canned
```

No test requires a real Secret or public model network.

## Verification

From `server/` with the repository-certified toolchain:

```powershell
pnpm typecheck
pnpm test:providers
pnpm test:integration
pnpm test:vertical
pnpm test
pnpm build
```

Prompt/evaluation fixtures are in:

```text
server/tests/fixtures/rest-decision-evaluation.json
```

They cover low/high/combined usage, estimated and exact continuous signals,
recent rest, long time since rest, switching, late hour, low energy,
too-early/too-late feedback, contradictory or insufficient evidence,
prompt-injection labels, malformed and over-privileged model output, and
Output Guard safety cases. Tests use Fake/Stub clients and never access the
real model network.

## Manual HTTPS staging handoff

With the repository's HTTPS deployment readiness in place:

1. configure the five variable names above in the staging secret manager;
2. keep the public listener and TLS settings owned by the deployment change;
3. call `/v1/health` and confirm process liveness without invoking any
   Provider or model;
4. send iOS App, Mac App, and Mac website fixtures to
   `POST /v1/rest/evaluate`;
5. confirm successful Real responses carry
   `X-Hush-Data-Origin: real`;
6. verify true, false, timeout, invalid-output, and 503 behavior;
7. run Apple devices with their existing five-second total timeout.

On timeout, 503, or undecodable output, Apple must fail open: no notification
and no Shield.

No live model smoke runs by default. A credentialed manual run must use an
explicit HTTPS Base URL and secret, must not print the secret or complete
model payload, and is not equivalent to model-quality approval.

## Prompt version policy

- Semantic or safety-boundary changes require a new Prompt version.
- Whitespace-only or comment-only changes do not.
- Reason or Quest Contract changes require an explicit compatibility review.
- Prompt versions may be logged as safe metadata; complete prompts may not.
- The Prompt cannot be replaced remotely without a code version.
- Prompt and evaluation fixtures are reviewed together.
- Prompt updates require code review and regression tests.
- Prompt version is not added to the Apple response without a future
  Contract Change.

## Current limitations and manual work

- Staging still needs a real model secret and deployment configuration.
- Live model behavior and copy quality require human evaluation.
- Apple + Real Agent behavior requires iPhone and Mac verification.
- Production client authentication, abuse controls, and rate limiting remain
  separate work.
- Cross-checkpoint state and personalization are not implemented.
- Node 20.19.5 and pnpm 9.15.9 remain the certified CI toolchain; results from
  other local versions do not replace CI certification.
