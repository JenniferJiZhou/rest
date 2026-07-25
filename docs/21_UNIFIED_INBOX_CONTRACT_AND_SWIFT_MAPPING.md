# Unified Inbox Contract and Swift Mapping

Status: backend Contract and Canned Mock Vertical Slice implemented
Owner handoff: W1 / P2 -> Apple Owner and future Provider Owners

## Capability boundary

The backend now provides provider-neutral Unified Inbox contracts, fixed mock
fixtures, draft editing, optimistic concurrency, short-lived confirmation,
and explicitly simulated Canned delivery. It does not contain a Feishu,
DingTalk, Outlook, or QQ Mail adapter and never performs a real external
send.

Swift Codable types, URLSession wiring, and Fixture replacement remain Apple
Owner work. The examples below describe the mapping; they are not checked-in
Swift implementation.

## HTTPS and endpoint matrix

Configure only the root platform URL:

```text
https://<deployed-origin>
```

The client appends the endpoint path. Do not hard-code a host in a feature
view.

| Method | Path | Request | Success |
|---|---|---|---|
| GET | `/v1/inbox/items` | optional `cursor`, `source`, `status`, `needs_reply` | `UnifiedInboxListResponseDTO` |
| GET | `/v1/inbox/items/{itemId}` | path ID | `UnifiedInboxItemResponseDTO` |
| POST | `/v1/inbox/items/{itemId}:acknowledge` | `AcknowledgeRequestDTO` | `UnifiedInboxItemResponseDTO` |
| GET | `/v1/inbox/drafts/{draftId}` | path ID | `UnifiedInboxDraftResponseDTO` |
| PATCH | `/v1/inbox/drafts/{draftId}` | `PatchDraftRequestDTO` | `UnifiedInboxDraftResponseDTO` |
| POST | `/v1/inbox/drafts/{draftId}/confirmation` | `ConfirmationRequestDTO` | `ConfirmationResponseDTO` |
| POST | `/v1/inbox/drafts/{draftId}:send` | `SendRequestDTO` | `SendResponseDTO` |

All routes reuse the existing HTTPS listener, Contract headers, proxy-aware
security headers, body limit, and log redaction. No TLS termination or
cloud-platform behavior is implemented in the Inbox feature.

## JSON-to-Swift field mapping

### Item summary and detail

| JSON | Swift | Type |
|---|---|---|
| `id` | `id` | `String` |
| `source` | `source` | `UnifiedInboxSourceDTO` |
| `conversation_name` | `conversationName` | `String` |
| `sender_display_name` | `senderDisplayName` | `String` |
| `subject` | `subject` | `String` |
| `preview` | `preview` | `String` |
| `received_at` | `receivedAt` | `Date` |
| `needs_reply` | `needsReply` | `Bool` |
| `is_unread` | `isUnread` | `Bool` |
| `priority` | `priority` | `UnifiedInboxPriorityDTO` |
| `status` | `status` | `UnifiedInboxItemStatusDTO` |
| `draft_id` | `draftId` | `String?` |
| `body` | `body` | `String`, detail only |
| `participants` | `participants` | `[ParticipantDTO]`, detail only |
| `attachments` | `attachments` | `[AttachmentMetadataDTO]`, detail only |
| `provider_capabilities` | `providerCapabilities` | `ProviderCapabilitiesDTO` |
| `acknowledged_at` | `acknowledgedAt` | `Date?` |

Attachment values are metadata only: `id`, `file_name`, `media_type`, and
`size_bytes`. There is no local path, Secret URL, OAuth value, or provider
payload.

### Draft, confirmation, and send result

| JSON | Swift | Type |
|---|---|---|
| `item_id` | `itemId` | `String` |
| `body` | `body` | `String` |
| `status` | `status` | `UnifiedInboxDraftStatusDTO` |
| `version` | `version` | `Int` |
| `updated_at` | `updatedAt` | `Date` |
| `confirmation_state` | `confirmationState` | `ConfirmationStateDTO` |
| `sent_at` | `sentAt` | `Date?` |
| `confirmation_id` | `confirmationId` | `String` |
| `draft_version` | `draftVersion` | `Int` |
| `expires_at` | `expiresAt` | `Date` |
| `delivery_mode` | `deliveryMode` | `DeliveryModeDTO` |

`delivery_mode=simulated` and `X-Hush-Data-Origin=mock` must be presented as
Fixture/demo data. They are not evidence of a Feishu, DingTalk, Outlook, or
QQ Mail send.

## Codable example

```swift
struct UnifiedInboxItemSummaryDTO: Decodable, Identifiable {
    let id: String
    let source: UnifiedInboxSourceDTO
    let conversationName: String
    let senderDisplayName: String
    let subject: String
    let preview: String
    let receivedAt: Date
    let needsReply: Bool
    let isUnread: Bool
    let priority: UnifiedInboxPriorityDTO
    let status: UnifiedInboxItemStatusDTO
    let draftId: String?

    enum CodingKeys: String, CodingKey {
        case id, source, subject, preview, priority, status
        case conversationName = "conversation_name"
        case senderDisplayName = "sender_display_name"
        case receivedAt = "received_at"
        case needsReply = "needs_reply"
        case isUnread = "is_unread"
        case draftId = "draft_id"
    }
}

struct UnifiedInboxDraftDTO: Decodable {
    let id: String
    let itemId: String
    let body: String
    let status: UnifiedInboxDraftStatusDTO
    let version: Int
    let updatedAt: Date
    let confirmationState: ConfirmationStateDTO
    let sentAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, body, status, version
        case itemId = "item_id"
        case updatedAt = "updated_at"
        case confirmationState = "confirmation_state"
        case sentAt = "sent_at"
    }
}
```

Request DTOs should be strict and operation-specific:

```swift
struct UpdateDraftBodyRequestDTO: Encodable {
    let schemaVersion = "1.0"
    let requestId: String
    let operation = "update_body"
    let expectedVersion: Int
    let body: String

    enum CodingKeys: String, CodingKey {
        case operation, body
        case schemaVersion = "schema_version"
        case requestId = "request_id"
        case expectedVersion = "expected_version"
    }
}

struct DiscardDraftRequestDTO: Encodable {
    let schemaVersion = "1.0"
    let requestId: String
    let operation = "discard"
    let expectedVersion: Int
}
```

Do not encode a body with `operation=discard`.

## Date decoding

All Contract timestamps are ISO 8601 with an explicit timezone. Use one
shared decoder that accepts standard internet date-time and fractional
seconds. Do not parse using the device locale or assume the staging server's
timezone.

```swift
let formatter = ISO8601DateFormatter()
formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
```

Provide a second standard `.withInternetDateTime` attempt when fractional
seconds are absent.

## Unknown enum compatibility

Known source values are `feishu`, `dingtalk`, `outlook`, and `qq_mail`.
Known priority includes `uncertain`. A newer server enum must not crash the
whole list. Decode enums with an `unknown(String)` or `.unknown` fallback,
retain the raw value for diagnostics, and disable unsupported mutations for
that row.

Never map an unknown priority to `high`; use the equivalent of `uncertain`.
Never infer Provider capabilities from `source`; honor
`provider_capabilities`.

## URLSession client surface

Suggested actor or Sendable client interface:

```swift
protocol UnifiedInboxAPIClient {
    func listItems(
        cursor: String?,
        source: UnifiedInboxSourceDTO?,
        status: UnifiedInboxItemStatusDTO?,
        needsReply: Bool?
    ) async throws -> UnifiedInboxListResponseDTO

    func item(id: String) async throws -> UnifiedInboxItemResponseDTO
    func acknowledge(itemId: String) async throws -> UnifiedInboxItemResponseDTO
    func draft(id: String) async throws -> UnifiedInboxDraftResponseDTO
    func updateDraft(
        id: String,
        expectedVersion: Int,
        body: String
    ) async throws -> UnifiedInboxDraftResponseDTO
    func discardDraft(
        id: String,
        expectedVersion: Int
    ) async throws -> UnifiedInboxDraftResponseDTO
    func createConfirmation(
        draftId: String,
        expectedVersion: Int
    ) async throws -> ConfirmationResponseDTO
    func send(
        draftId: String,
        confirmationId: String,
        expectedVersion: Int
    ) async throws -> SendResponseDTO
}
```

For every request send:

```text
X-Request-ID
X-Client-Version
X-Contract-Version: 1.0
```

Mutation routes also send an `Idempotency-Key`. The JSON `request_id` must
equal `X-Request-ID`. Preserve both values for a retry; changing the body
under the same request ID or idempotency key returns `409`.

## Client state and failure behavior

- Store the last server-returned draft `version`.
- Send that value as `expected_version` for edit, discard, confirmation, and
  send.
- On `409` version conflict, fetch the draft again and show the refreshed
  content before offering another edit.
- Any edit invalidates the previous confirmation. Clear the local
  confirmation immediately after a successful edit.
- Treat confirmation IDs as short-lived, draft/version-bound values. Do not
  persist them as account authentication.
- On expired, missing, or mismatched confirmation, create a new confirmation
  only after showing the current draft/version.
- On send `503`, keep the draft and confirmation UI state, show a retryable
  failure, and do not add the item to a local sent-ID success set.
- On `delivery_mode=simulated`, show Fixture/demo language. Only a future
  `delivery_mode=real` plus `X-Hush-Data-Origin=real` may be presented as a
  real Provider delivery.

State progression:

```text
editing -> confirmed -> sending -> sent
   |           |
   +-> discarded
   +-> editing (confirmation expired or Provider send failed)
```

Editing increments `version` and invalidates the prior confirmation. A failed
Provider call returns the draft to safely retryable `confirmed`; it never
marks the draft sent. Atomic repository claims allow at most one concurrent
send.

## Fixture replacement

1. Add the DTOs and shared date/enum decoding outside the feature view.
2. Add one URLSession client configured from the platform-provided root Base
   URL.
3. Decode `contracts/fixtures/unified-inbox-items.json` in a DTO test.
4. Replace `UnifiedInboxItem.fixture` loading with `listItems`.
5. Replace local detail lookup with the item endpoint.
6. Replace in-memory draft edits/discard with PATCH using the last version.
7. Create a confirmation immediately before the send confirmation UI.
8. Send only after explicit user confirmation.
9. Preserve Fixture mode as a separate injected client; never silently use it
   after a Normal network failure.
10. Verify `mock`/`simulated`, 409, 503, timeout, and malformed response UI.

## Backend configuration and limitations

```text
HUSH_UNIFIED_INBOX_PROVIDER=unavailable
HUSH_UNIFIED_INBOX_PROVIDER=canned
```

Normal defaults to `unavailable`. `canned` must be explicit. A valid Demo
Token selects a separate Canned provider, repository, and idempotency store.
An invalid Demo Token is rejected before Provider access.

Repositories and idempotency records are in process memory. Restarting loses
edits, confirmations, and sent state. Multiple instances do not share CAS or
send claims. This is suitable only for controlled staging. Formal client
authentication, rate limiting, OAuth, persistent storage, real Provider
adapters, real delivery, and multi-instance coordination remain future work.
