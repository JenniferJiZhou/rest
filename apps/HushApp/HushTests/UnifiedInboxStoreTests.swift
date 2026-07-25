import XCTest
@testable import Hush

@MainActor
final class UnifiedInboxStoreTests: XCTestCase {
    func testLoadConsumesEveryPageAndRejectsMixedOrigin() async {
        let client = ScriptedInboxClient()
        client.statusResult = .success(.init(value: [Self.status(.ready)], origin: .real))
        client.pages = [
            .success(.init(value: .init(items: [Self.item(id: "secret-1")], nextCursor: "next"), origin: .real)),
            .success(.init(value: .init(items: [Self.item(id: "secret-2")], nextCursor: nil), origin: .cached))
        ]
        let model = UnifiedInboxViewModel(client: client)

        await model.load()

        XCTAssertEqual(client.listCursors, [nil, "next"])
        XCTAssertEqual(model.loadState, .failed("服务器返回了不一致的数据来源，已停止展示。"))
        XCTAssertEqual(model.mode, .real)
    }

    func testReadyEmptyDiffersFromUnavailable() async {
        let ready = ScriptedInboxClient()
        ready.statusResult = .success(.init(value: [Self.status(.ready)], origin: .real))
        ready.pages = [.success(.init(value: .init(items: [], nextCursor: nil), origin: .real))]
        let readyModel = UnifiedInboxViewModel(client: ready)
        await readyModel.load()
        XCTAssertEqual(readyModel.loadState, .empty)

        let unavailable = ScriptedInboxClient()
        unavailable.statusResult = .success(.init(value: [Self.status(.unavailable)], origin: .real))
        unavailable.pages = [.success(.init(value: .init(items: [], nextCursor: nil), origin: .real))]
        let unavailableModel = UnifiedInboxViewModel(client: unavailable)
        await unavailableModel.load()
        XCTAssertEqual(unavailableModel.loadState, .failed("消息渠道当前不可用。"))
    }

    func testMutationsUseDisplayedRevisionAndVersionAndEditInvalidatesConfirmation() async {
        let client = configuredClient()
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.acknowledgeSelected()
        await model.loadDraft()
        model.beginReview()
        await model.requestConfirmation()
        XCTAssertEqual(model.sendState, .confirming)
        await model.updateDraft(content: "edited")

        XCTAssertEqual(client.acknowledgements, [7])
        XCTAssertEqual(client.draftUpdates.map(\.version), [4])
        XCTAssertEqual(model.sendState, .idle)
    }

    func testAmbiguousSendIsUnknownAndNeverRetried() async {
        let client = configuredClient()
        client.sendResult = .failure(URLError(.networkConnectionLost))
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.loadDraft()
        model.beginReview()
        await model.requestConfirmation()
        await model.sendConfirmedDraft()

        XCTAssertEqual(model.sendState, .unknown)
        XCTAssertEqual(client.sendCalls.count, 1)
        XCTAssertFalse(client.sendCalls[0].idempotencyKey.isEmpty)
    }

    func testDraftConflictRefreshesAndRequiresFreshReview() async {
        let client = configuredClient()
        let conflict = InboxErrorResponse(
            schemaVersion: "1.0",
            requestID: "conflict-request",
            error: .init(
                code: "INBOX_VERSION_CONFLICT",
                message: "stale version",
                retryable: false,
                fallback: nil,
                details: nil
            )
        )
        client.updateResult = .failure(
            UnifiedInboxAPIError.versionConflict(conflict)
        )
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.loadDraft()
        client.draftResult = .success(
            .init(value: Self.draft(version: 8), origin: .real)
        )
        model.beginReview()
        await model.requestConfirmation()

        await model.updateDraft(content: "stale edit")

        XCTAssertEqual(model.draft?.version, 8)
        XCTAssertEqual(model.sendState, .idle)
        XCTAssertEqual(client.draftUpdates.map(\.version), [4])
    }

    func testEachExplicitSendActionUsesFreshIdempotencyKey() async {
        let client = configuredClient()
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.loadDraft()

        model.beginReview()
        await model.requestConfirmation()
        await model.sendConfirmedDraft()
        model.beginReview()
        await model.requestConfirmation()
        await model.sendConfirmedDraft()

        XCTAssertEqual(client.sendCalls.count, 2)
        XCTAssertNotEqual(
            client.sendCalls[0].idempotencyKey,
            client.sendCalls[1].idempotencyKey
        )
    }

    private func configuredClient() -> ScriptedInboxClient {
        let client = ScriptedInboxClient()
        let value = Self.item(id: "private-item", revision: 7)
        client.statusResult = .success(.init(value: [Self.status(.ready)], origin: .real))
        client.pages = [.success(.init(value: .init(items: [value], nextCursor: nil), origin: .real))]
        client.itemResult = .success(.init(value: value, origin: .real))
        client.ackResult = .success(.init(value: value, origin: .real))
        client.draftResult = .success(.init(value: Self.draft(version: 4), origin: .real))
        client.updateResult = .success(.init(value: Self.draft(version: 5), origin: .real))
        client.confirmationResult = .success(.init(value: .init(confirmationToken: "confirmation-token", expiresAt: "2026-07-25T01:00:00Z"), origin: .real))
        client.sendResult = .success(.init(value: .init(draftID: "private-draft", provider: .feishu, status: .sent, providerMessageID: nil, sentAt: "2026-07-25T00:00:00Z"), origin: .real))
        return client
    }

    private static func item(id: String, revision: Int = 1) -> InboxItemResponse {
        .init(id: id, provider: .feishu, accountID: "private-account", conversationID: "private-conversation", conversationType: .direct, conversationName: "项目群", providerMessageID: "private-provider-message", sender: "小王", senderRef: "participant_private", recipients: [], subject: "进度", content: "请确认", receivedAt: "2026-07-25T00:00:00Z", coverage: coverage, itemKind: .message, revision: revision, messageCount: 1, windowStartedAt: "2026-07-25T00:00:00Z", windowEndedAt: "2026-07-25T00:00:00Z", sealedAt: nil, acknowledgedAt: nil, summary: "等待确认", importantPoints: [], todos: [], priority: .normal, needsReply: true, replyTargets: [.init(targetID: "participant_private", displayName: "小王", reason: "等待回复")], draftID: "private-draft", syncStatus: .ready)
    }

    private static func draft(version: Int) -> InboxDraftResponse {
        .init(id: "private-draft", inboxItemID: "private-item", content: "reply", contentType: .text, version: version, origin: .user, status: .edited, providerDraftID: nil, createdAt: "2026-07-25T00:00:00Z", updatedAt: "2026-07-25T00:00:00Z")
    }

    private static func status(_ state: InboxSyncStateResponse) -> InboxSyncStatusResponse {
        .init(provider: .feishu, accountID: "private-account", status: state, checkpoint: nil, lastSyncedAt: nil, lastError: nil, coverage: coverage)
    }

    private static var coverage: InboxCoverageResponse {
        .init(source: .officialAPI, complete: true, note: nil)
    }
}

private final class ScriptedInboxClient: UnifiedInboxClient, @unchecked Sendable {
    var statusResult: Result<UnifiedInboxResponse<[InboxSyncStatusResponse]>, Error>!
    var pages: [Result<UnifiedInboxResponse<InboxPageResponse>, Error>] = []
    var itemResult: Result<UnifiedInboxResponse<InboxItemResponse>, Error>!
    var ackResult: Result<UnifiedInboxResponse<InboxItemResponse>, Error>!
    var draftResult: Result<UnifiedInboxResponse<InboxDraftResponse>, Error>!
    var updateResult: Result<UnifiedInboxResponse<InboxDraftResponse>, Error>!
    var confirmationResult: Result<UnifiedInboxResponse<InboxConfirmationResponse>, Error>!
    var sendResult: Result<UnifiedInboxResponse<InboxSendResultResponse>, Error>!
    var listCursors: [String?] = []
    var acknowledgements: [Int] = []
    var draftUpdates: [(content: String, version: Int)] = []
    var sendCalls: [(version: Int, idempotencyKey: String)] = []

    func syncStatuses() async throws -> UnifiedInboxResponse<[InboxSyncStatusResponse]> { try statusResult.get() }
    func listItems(cursor: String?) async throws -> UnifiedInboxResponse<InboxPageResponse> { listCursors.append(cursor); return try pages.removeFirst().get() }
    func item(id: String) async throws -> UnifiedInboxResponse<InboxItemResponse> { try itemResult.get() }
    func acknowledge(id: String, revision: Int) async throws -> UnifiedInboxResponse<InboxItemResponse> { acknowledgements.append(revision); return try ackResult.get() }
    func draft(id: String) async throws -> UnifiedInboxResponse<InboxDraftResponse> { try draftResult.get() }
    func updateDraft(id: String, content: String, version: Int) async throws -> UnifiedInboxResponse<InboxDraftResponse> { draftUpdates.append((content, version)); return try updateResult.get() }
    func confirmation(draftID: String) async throws -> UnifiedInboxResponse<InboxConfirmationResponse> { try confirmationResult.get() }
    func send(draftID: String, version: Int, confirmationToken: String, idempotencyKey: String) async throws -> UnifiedInboxResponse<InboxSendResultResponse> { sendCalls.append((version, idempotencyKey)); return try sendResult.get() }
}
