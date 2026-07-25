# Apple Unified Inbox API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a contract-aligned Real Mode to the shared SwiftUI Inbox while retaining the explicitly selected fixture Sample Mode.

**Architecture:** Feature-scoped Codable transport types feed a small URLSession client that returns both decoded values and validated origin metadata. Separate Sample and API-backed observable stores map transport data into privacy-filtered presentation state; a coordinator selects configuration, Real, or Sample without silent fallback.

**Tech Stack:** Swift 6, SwiftUI, Foundation URLSession, XCTest, existing Fastify `/v1/inbox/*` API.

## Global Constraints

- OpenAPI and `contracts/schemas/inbox-*.schema.json` are the only contract source.
- `inbox-event-batch-demo.json` is connector input and must never be decoded by Apple.
- `HUSH_APP_TOKEN`, confirmation tokens, and idempotency keys are memory-only and never logged.
- Provider account/message/conversation IDs and target IDs are never presented, persisted, exported, or logged.
- Real Mode never falls back to Sample Mode after an error.
- Only `X-Hush-Data-Origin: real` is presented as live; `cached` is visibly stale and `mock` is Sample.
- No automatic retry is allowed after send starts.

---

### Task 1: Contract Codable Models

**Files:**
- Create: `apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxTransportModels.swift`
- Create: `apps/HushApp/HushTests/UnifiedInboxTransportModelsTests.swift`
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces: `InboxItemResponse`, `InboxDraftResponse`, `InboxSyncStatusResponse`, `InboxConfirmationResponse`, `InboxSendResultResponse`, `InboxPageResponse`, `InboxErrorResponse`.

- [ ] **Step 1: Write fixture decode tests**

Load `inbox-item-enriched-demo.json`, `inbox-group-digest-demo.json`, and `inbox-draft-edited-demo.json` from test fixtures and assert provider, revision/version, nullable fields, reply targets, and group digest fields. Add an inline page wrapper test:

```swift
let page = try decoder.decode(InboxPageResponse.self, from: Data("{\"items\":[],\"next_cursor\":null}".utf8))
XCTAssertTrue(page.items.isEmpty)
XCTAssertNil(page.nextCursor)
```

- [ ] **Step 2: Verify tests fail because models do not exist**

Run: `xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test`

Expected: compile failure for the missing transport model types.

- [ ] **Step 3: Define exact Codable transport types**

Use enums with raw strings for provider, priority, sync state, draft status, origin, send status, and content type. Use `CodingKeys` for every snake_case field. Decode timestamps as `String` in transport types so invalid date handling remains explicit at the mapping boundary. Include all schema fields, including sensitive IDs, but keep types internal to the feature.

- [ ] **Step 4: Register fixture resources and run tests**

Add only the three response fixtures to `HushTests` resources. Do not register `inbox-event-batch-demo.json`. Expected: all model tests PASS.

- [ ] **Step 5: Commit models**

```bash
git add apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxTransportModels.swift apps/HushApp/HushTests/UnifiedInboxTransportModelsTests.swift apps/HushApp/Hush.xcodeproj
git commit -m "feat(inbox): add Apple transport models"
```

---

### Task 2: Configuration, Headers, and Origin Gate

**Files:**
- Create: `apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxConfiguration.swift`
- Create: `apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxAPIClient.swift`
- Create: `apps/HushApp/HushTests/UnifiedInboxAPIClientTests.swift`
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces:

```swift
enum UnifiedInboxDataOrigin: String { case real, mock, cached }
struct UnifiedInboxResponse<Value> { let value: Value; let origin: UnifiedInboxDataOrigin }
struct UnifiedInboxRuntimeConfiguration { let baseURL: URL; let appToken: String }
protocol UnifiedInboxClient: Sendable {
    func syncStatuses() async throws -> UnifiedInboxResponse<[InboxSyncStatusResponse]>
    func listItems(cursor: String?) async throws -> UnifiedInboxResponse<InboxPageResponse>
    func item(id: String) async throws -> UnifiedInboxResponse<InboxItemResponse>
    func acknowledge(id: String, revision: Int) async throws -> UnifiedInboxResponse<InboxItemResponse>
    func draft(id: String) async throws -> UnifiedInboxResponse<InboxDraftResponse>
    func updateDraft(id: String, content: String, version: Int) async throws -> UnifiedInboxResponse<InboxDraftResponse>
    func confirmation(draftID: String) async throws -> UnifiedInboxResponse<InboxConfirmationResponse>
    func send(draftID: String, version: Int, confirmationToken: String, idempotencyKey: String) async throws -> UnifiedInboxResponse<InboxSendResultResponse>
}
```

- [ ] **Step 1: Add URL validation and request-header tests**

Test macOS loopback HTTP acceptance, iOS private IPv4 HTTP acceptance, public HTTP rejection, HTTPS acceptance, 31-character token rejection, fresh request IDs, stable 32-128 character App session, body/header request-ID equality, and missing/unsupported origin rejection.

- [ ] **Step 2: Verify tests fail**

Expected: compile failure for missing configuration/client types.

- [ ] **Step 3: Implement validation and the URLSession client**

Use `URLSessionConfiguration.ephemeral`, a per-client random App session, and a request builder that always adds Authorization, `X-Request-ID`, `X-Client-Version`, `X-Contract-Version: 1.0`, and `X-Hush-App-Session`. Percent-encode path components and construct cursor queries with `URLComponents`. Decode non-2xx bodies as `InboxErrorResponse` and map `INBOX_VERSION_CONFLICT` distinctly.

- [ ] **Step 4: Run client tests**

Use a test-only `URLProtocol` to inspect requests and return response headers/bodies. Expected: all validation, headers, body correlation, decoding, and origin tests PASS.

- [ ] **Step 5: Commit the client boundary**

```bash
git add apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxConfiguration.swift apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxAPIClient.swift apps/HushApp/HushTests/UnifiedInboxAPIClientTests.swift apps/HushApp/Hush.xcodeproj
git commit -m "feat(inbox): add authenticated Apple API client"
```

---

### Task 3: API-backed Store and Presentation State

**Files:**
- Create: `apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxStore.swift`
- Create: `apps/HushApp/HushTests/UnifiedInboxStoreTests.swift`
- Modify: `apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxView.swift`

**Interfaces:**
- Consumes: `UnifiedInboxClient` from Task 2.
- Produces:

```swift
enum UnifiedInboxMode { case sample, real }
enum UnifiedInboxLoadState { case idle, loading, loaded, empty, failed(String) }
enum UnifiedInboxSendState { case idle, reviewing, confirming, sending, sent, failed(String), unknown }
@MainActor protocol UnifiedInboxStoreProtocol: AnyObject {
    var mode: UnifiedInboxMode { get }
    var origin: UnifiedInboxDataOrigin? { get }
    func load() async
    func refresh() async
}
@MainActor final class UnifiedInboxViewModel: ObservableObject {
    let store: any UnifiedInboxStoreProtocol
    // Publishes privacy-filtered list, detail, draft, load, and send state.
}
```

- [ ] **Step 1: Add store-state tests with a scripted fake client**

Cover all pages consumed until `next_cursor == nil`, mixed-origin rejection, ready-empty versus unavailable, detail refresh, exact displayed acknowledgement revision, exact draft PATCH version, conflict refresh requiring review, confirmation invalidation after edit, fresh idempotency key per user action, explicit failed send, and transport interruption mapped to `unknown` without another client call.

- [ ] **Step 2: Verify store tests fail**

Expected: compile failure for missing store types.

- [ ] **Step 3: Implement privacy-filtered presentation mapping**

Expose provider, sender display text, conversation name, subject/summary, important points, todos, priority, reply requirement, readable targets, revision, draft text/version, and status. Keep item/draft IDs private to the store. Do not expose account ID, provider message ID, conversation ID, sender reference, provider draft ID, or target ID through presentation models.

- [ ] **Step 4: Implement guarded mutations**

Capture the displayed revision/version when the user begins review. On conflict, replace state with freshly fetched data, clear review/confirmation, and require another explicit review. After send begins, perform exactly one client call; map an unreadable/transport result to `.unknown` and disable send.

- [ ] **Step 5: Run store tests**

Expected: all store tests PASS, including call-count assertions proving no silent fallback or send retry.

- [ ] **Step 6: Commit the store**

```bash
git add apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxStore.swift apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxView.swift apps/HushApp/HushTests/UnifiedInboxStoreTests.swift
git commit -m "feat(inbox): add real Apple inbox store"
```

---

### Task 4: Real-first Mode UI and Memory-only Token

**Files:**
- Create: `apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxConnectionView.swift`
- Modify: `apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxView.swift`
- Modify: `apps/HushApp/Shared/Features/Demo/HushDemoRootView.swift`
- Modify: `apps/HushApp/iOSApp/App/HushApp.swift`
- Modify: `apps/HushApp/MacMenuBar/App/HushMacApp.swift`
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj`
- Modify: `apps/HushApp/Hush.xcodeproj/xcshareddata/xcschemes/Hush.xcscheme`
- Create: `apps/HushApp/HushTests/UnifiedInboxModeCoordinatorTests.swift`

**Interfaces:**
- Produces: a coordinator that holds token/session state in memory, persists at most the base URL, and constructs either the API store or the explicit Sample store.

- [ ] **Step 1: Test mode selection and clearing behavior**

Assert configured base URL plus runtime token selects Real, missing token selects configuration, explicit Sample selects Sample, Real load failure remains Real error, and changing URL/leaving Real clears the token and confirmation.

- [ ] **Step 2: Verify tests fail**

Expected: missing coordinator type.

- [ ] **Step 3: Implement the connection and mode UI**

Use `SecureField` for `HUSH_APP_TOKEN`. Show no fixture items before explicit Sample selection. Real UI shows provider readiness, loading/empty/error/origin states, current provider/conversation/targets before review, and separate failed/unknown send messages. Preserve stable button dimensions and disable mutations in flight.

- [ ] **Step 4: Add narrow iOS local-network configuration**

Add `INFOPLIST_KEY_NSLocalNetworkUsageDescription` with a provider-sync explanation and enable local networking without `NSAllowsArbitraryLoads` or public-host exceptions. Keep the existing Agent HTTPS validator unchanged; Unified Inbox uses its separate validator.

- [ ] **Step 5: Run coordinator tests and both builds**

Expected: tests, iOS Simulator build, and macOS build PASS.

- [ ] **Step 6: Commit Real-first mode**

```bash
git add apps/HushApp
git commit -m "feat(inbox): wire real-first Apple inbox mode"
```

---

### Task 5: Local End-to-end Integration

**Files:**
- Modify if commands changed: `docs/unified-inbox-apple-frontend-handoff.md`
- Verify all other files.

- [ ] **Step 1: Run all server checks**

Run: `pnpm --dir server check`

Expected: PASS.

- [ ] **Step 2: Start the server with non-secret test tokens**

Use `NODE_ENV=test`, loopback, a selected `PORT`, canned Rest provider, and the existing fixture/mock Inbox composition. Supply distinct 32+ character App and Connector test tokens only in the process environment.

- [ ] **Step 3: Run Inbox smoke without real send**

Run `pnpm --dir server smoke:inbox` with `HUSH_SMOKE_ALLOW_SEND` absent.

Expected: sync/list/detail/acknowledge/draft/edit/confirmation protocol succeeds and the script refuses send.

- [ ] **Step 4: Run Apple tests and builds**

Run:

```bash
xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test
xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme HushMac -destination 'platform=macOS,arch=arm64' CODE_SIGNING_ALLOWED=NO build
```

Expected: PASS.

- [ ] **Step 5: Run the native Real-mode flow**

On macOS use loopback; on iOS use the Demo Mac's private LAN IPv4. Verify configured launch goes directly to Real, origins remain consistent, pagination completes, conflict UI requires review, and a simulated ambiguous response is not retried.

- [ ] **Step 6: Verify real providers only when credentials are supplied**

With server-only StepFun and Feishu/DingTalk credentials, follow `docs/feishu-dingtalk-real-validation/README.md`. Do not record private message content or identifiers. If credentials are absent, report this live-provider step as environment-blocked while retaining passing mock protocol evidence.

- [ ] **Step 7: Commit documentation corrections, if any**

```bash
git add docs/unified-inbox-apple-frontend-handoff.md
git commit -m "docs(inbox): record Apple real-mode validation"
```

Skip this commit when the documented commands remain accurate.
