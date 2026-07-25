# Feishu and DingTalk Conversation Digests Design

**Date:** 2026-07-24

**Owner:** W2 / P3

**Status:** Approved for implementation planning

## Goal

Hush runs in the background after the user starts it. It incrementally reads
messages visible to the authorized Feishu or DingTalk account, groups group-chat
messages that arrived since the user last viewed that conversation digest, and
uses StepFun to generate:

- a conversation-level summary;
- important points and todos;
- priority and whether the user needs to respond;
- an editable reply draft when a response is useful; and
- a validated list of people who should be addressed or mentioned.

The user edits the draft in Hush and remains the only party that can confirm a
send. StepFun never receives provider credentials or a sending tool.

## Scope

This iteration includes:

- Feishu through the official `lark-cli`, using the authorized user's existing
  direct messages and group chats;
- DingTalk through the official `dws`, using the externally validated account
  and conversations;
- group-conversation aggregation and source metadata;
- StepFun `step-3.7-flash` summaries and drafts;
- participant-target detection and provider-native mentions;
- a sanitized external smoke-test harness for both providers.

This iteration excludes:

- Outlook and QQ Mail follow-up;
- changes to SwiftUI, Xcode projects, signing, or Apple entitlements;
- final client wiring before the Unified Inbox frontend branch is merged into
  `main`;
- replacing the existing Anthropic-backed Agent owned outside W2/P3.

The frontend reference is
`origin/feat/m1/ambient-client-demo` at commit `044880c`. Its fixture cards
already use group names such as `产品讨论组` and `开发协作群` as the primary source
label. W2/P3 will prepare the public contracts for that presentation but will
not edit or merge the frontend branch.

## Architecture

```text
lark-cli / dws
      |
      v
Provider Adapter
  - normalize raw messages
  - resolve conversation metadata
  - resolve participant identities
      |
      v
Raw message repository
  - dedupe by provider + account + provider_message_id
      |
      v
Conversation digest aggregator
  - direct message: existing message-level item
  - group chat: one open digest per unviewed period
      |
      v
StepFunInboxIntelligenceProvider
  - summary / points / todos / priority
  - needs_reply / reply_targets / editable draft
      |
      v
Unified Inbox API
      |
      v
User views -> digest is sealed
User edits -> confirms -> provider adapter sends
```

Raw provider payloads, CLI result types, and provider errors remain inside the
adapters. Public contracts contain normalized data only.

## Conversation and Participant Metadata

Each normalized raw message retains enough internal metadata to aggregate and
send safely:

- `conversation_id`: provider conversation identifier;
- `conversation_type`: `direct`, `group`, or `unknown`;
- `conversation_name`: group name or direct-message counterpart, nullable when
  the provider cannot resolve it;
- provider message ID and received time;
- sender display name;
- provider sender identifier, stored only behind the provider boundary;
- normalized text content.

Conversation metadata is resolved through official CLI/API capabilities. The
adapter caches metadata by `conversation_id` for one synchronization run so it
does not issue the same lookup for every message. A metadata lookup failure
does not discard the message: the stable conversation ID is retained,
`conversation_type` becomes `unknown` when necessary, and
`conversation_name` is nullable.

The public digest exposes the conversation source, but never exposes a provider
sender identifier. It contains:

- `conversation_id`;
- `conversation_type`;
- `conversation_name`;
- `window_started_at` and `window_ended_at`;
- `message_count`;
- `summary`, `important_points`, `todos`, `priority`, and `needs_reply`;
- `reply_targets`;
- `is_unread`, `digest_revision`, and the existing draft linkage/status.

For group digests, the public `sender` is nullable and the frontend displays
`conversation_name`. Direct-message items may continue to display the
counterpart. The frontend should not use opaque `conversation_id` as display
text.

## Unviewed-Period Aggregation

Group messages are aggregated by `provider + account_id + conversation_id`.
There is at most one open digest for a group conversation.

1. A new group message is stored and deduplicated.
2. If an unacknowledged digest exists and has not reached a safety boundary, the
   message is appended and `digest_revision` advances.
3. Otherwise, a new open digest is created.
4. StepFun enriches the current digest revision.
5. When the user opens the digest, the client acknowledges the exact revision.
   The backend seals it. Later messages create a new digest.

A digest is also sealed automatically when either boundary is reached:

- 24 hours since `window_started_at`; or
- 1000 source messages.

The 1000-message limit is a storage boundary, not a promise to send 1000 raw
messages in one model request. The StepFun adapter chunks or hierarchically
reduces large digests so each request stays within configured input and cost
limits, then produces one final conversation summary.

The acknowledgement action is represented by:

```text
POST /v1/inbox/items/{itemId}:acknowledge
```

It includes `expected_revision`. If a message arrives between display and
acknowledgement, the server returns a version conflict rather than silently
sealing unseen content.

Viewing seals a digest before the user edits its draft. This prevents later
messages or delayed AI results from overwriting a user-edited draft. Existing
draft `expectedVersion` rules remain in force.

## StepFun Integration

W2/P3 uses a dedicated `StepFunInboxIntelligenceProvider`. Inbox code must not
import the Anthropic SDK or read `CLAUDE_API_KEY` / `CLAUDE_MODEL`.

Configuration:

```dotenv
INBOX_STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1
INBOX_STEPFUN_MODEL=step-3.7-flash
INBOX_STEPFUN_API_KEY=
```

The real key exists only in the external test computer's local environment. It
must not be pasted into chat, committed, printed, included in errors, or written
to fixtures.

The provider uses native `fetch` to call
`POST {base_url}/chat/completions`; no new SDK dependency is required. System
instructions and untrusted message content use separate chat roles. No tools
are supplied.

For a group digest, StepFun receives ordered message records with synthetic
message and participant references. It may receive display names needed to
produce useful summaries, but it does not receive provider user IDs,
conversation IDs, account IDs, credentials, checkpoints, confirmation tokens,
or send APIs.

StepFun output is strict JSON validated by Zod. In addition to the existing
summary fields, it may return target references:

```json
{
  "reply_targets": [
    {
      "participant_ref": "p1",
      "mention_required": true,
      "reason": "该成员要求用户确认演示时间"
    }
  ]
}
```

Every returned reference must exist in the supplied participant set. The
backend maps it to an opaque Hush `target_id` and keeps the provider identifier
private. Unknown or invented references are rejected; Hush must never guess a
mention target.

Large group digests are summarized in bounded chunks. Intermediate summaries
contain no sending instructions and are validated before inclusion in the final
reduction.

## Public Reply Targets

The frontend receives targets only when StepFun found a concrete person to
address:

```json
{
  "target_id": "opaque-hush-target-id",
  "display_name": "张三",
  "mention_required": true,
  "reason": "张三要求你确认演示时间"
}
```

An empty `reply_targets` array means the card does not display individual
senders. If evidence suggests a reply is needed but the target cannot be
resolved, Hush reports that the reply target needs confirmation and does not
construct a provider mention.

The confirmation screen must show the provider, conversation name, final draft,
and resolved mention targets. The send command carries only opaque target IDs.
The backend validates that each target belongs to the sealed digest and target
conversation before mapping it to provider-native syntax:

- Feishu text/post mention using the authorized user's official send path;
- DingTalk group send using `--at-open-dingtalk-ids`, with matching
  `<@openDingTalkId>` placeholders in the message body.

StepFun cannot add, remove, or change targets after user confirmation.

## Frontend Compatibility

The current fixture UI can remain structurally similar:

- the existing card title position displays `conversation_name` for groups;
- `summary`, `important_points`, `todos`, `priority`, and `needs_reply` retain
  their current roles;
- `reply_targets` adds a compact “需要对接 / @某人” indicator only when nonempty;
- `is_unread` maps to the existing unread dot;
- opening a group digest triggers the acknowledgement call for the displayed
  revision;
- draft edit, discard, confirmation, and sent states continue to use the
  existing interaction.

Final field naming and Swift models are aligned only after the frontend branch
is merged into `main`.

## Failure and Safety Behavior

- Provider authentication, permission, metadata-resolution, pagination, and
  timeout failures are represented as sanitized provider states.
- Raw messages remain available when optional AI enrichment fails.
- StepFun 401/403, 429, timeout, 5xx, invalid JSON, invalid schema, and invalid
  participant references map to sanitized errors without request or response
  bodies.
- A failed metadata lookup does not drop an otherwise valid message.
- A digest revision conflict requires refresh; no content is silently sealed.
- Draft edits are never overwritten by late AI work.
- Sending still requires the latest draft version, a one-time confirmation
  token, and an idempotency key.
- An ambiguous provider send result remains `unknown` and is not automatically
  retried.
- No logs contain credentials, provider user IDs, real message bodies, or
  StepFun prompts/responses.

## Testing and External Validation

Automated tests use injected transports and Fixture/Unavailable providers:

- StepFun success for summary, targets, and draft;
- prompt-injection content treated as data;
- invalid JSON/schema and invented participant references;
- authentication, rate-limit, timeout, and server failures;
- group aggregation by conversation;
- deduplication of repeated provider messages;
- acknowledgement and revision conflicts;
- automatic rollover at 24 hours and 1000 messages;
- large-digest chunking;
- direct-message behavior unchanged;
- target membership validation and provider mention rendering;
- user-edited drafts protected from late AI results;
- confirmed idempotent send and ambiguous send results;
- log and fixture scans for secrets and real message content.

Real tests run on external computers:

1. Verify the exact Feishu or DingTalk identity and CLI authentication.
2. Start Hush with a short initial lookback and bounded first-sync batch.
3. Send controlled messages into a known direct conversation and group.
4. Verify one group digest is created for the unviewed period.
5. Verify the frontend-facing response contains the conversation source but
   hides individual senders when `reply_targets` is empty.
6. Verify StepFun `step-3.7-flash` produces a real summary and editable draft.
7. Add a controlled message that clearly requests action from one member and
   verify the resolved target is shown.
8. Open and acknowledge the digest, edit the draft, confirm the target and
   content, then send once through the provider adapter.
9. Restart Hush and verify checkpoint continuation and deduplication.
10. Save only a sanitized report containing provider, status, counts, and
    pass/fail results.

DingTalk's CLI/account environment is already validated externally; the
remaining DingTalk work is the Hush-to-DWS end-to-end path. Feishu uses the
user's real authorized account and existing conversations rather than a
separate test tenant.

## Completion Criteria

- W2/P3 Inbox production code has no Anthropic dependency or Claude
  configuration.
- Feishu and DingTalk group chats produce conversation-level unviewed-period
  digests.
- A digest seals on acknowledgement, 24 hours, or 1000 messages.
- The frontend receives stable conversation source fields.
- Individual senders are hidden by default for group digests.
- Reply targets are shown only when validated model output requires them.
- Provider-native mentions use backend-resolved identities.
- Real StepFun summaries and drafts work without granting the model sending
  authority.
- Both providers pass automated tests and the external sanitized smoke run.
- Outlook, QQ Mail, and final Apple client wiring remain explicitly deferred.
