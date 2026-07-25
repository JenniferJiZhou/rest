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
        XCTAssertEqual(model.loadState, .failed("服务器未返回真实数据，已停止展示。"))
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

    func testRealStoreRejectsConsistentMockOrigin() async {
        let client = ScriptedInboxClient()
        client.statusResult = .success(
            .init(value: [Self.status(.ready)], origin: .mock)
        )
        client.pages = [
            .success(.init(value: .init(items: [], nextCursor: nil), origin: .mock))
        ]
        let model = UnifiedInboxViewModel(client: client)

        await model.load()

        XCTAssertEqual(
            model.loadState,
            .failed("服务器未返回真实数据，已停止展示。")
        )
        XCTAssertNil(model.origin)
    }

    func testMutationsUseDisplayedRevisionAndVersionAndEditInvalidatesConfirmation() async {
        let client = configuredClient()
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.acknowledgeSelected()
        await model.loadDraft()
        model.beginReview(displayedContent: model.draft!.content)
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
        model.beginReview(displayedContent: model.draft!.content)
        await model.requestConfirmation()
        await model.sendConfirmedDraft()

        XCTAssertEqual(model.sendState, .unknown)
        XCTAssertEqual(client.sendCalls.count, 1)
        XCTAssertFalse(client.sendCalls[0].idempotencyKey.isEmpty)
        await model.updateDraft(content: "must not unlock")
        model.beginReview(displayedContent: model.draft!.content)
        XCTAssertEqual(model.sendState, .unknown)
        XCTAssertEqual(client.sendCalls.count, 1)
        XCTAssertTrue(client.draftUpdates.isEmpty)
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
        model.beginReview(displayedContent: model.draft!.content)
        await model.requestConfirmation()

        await model.updateDraft(content: "stale edit")

        XCTAssertEqual(model.draft?.version, 8)
        XCTAssertEqual(model.sendState, .idle)
        XCTAssertEqual(client.draftUpdates.map(\.version), [4])
    }

    func testEachExplicitSendActionUsesFreshIdempotencyKey() async {
        let client = configuredClient()
        client.sendResult = .success(
            .init(
                value: .init(
                    draftID: "private-draft",
                    provider: .feishu,
                    status: .failed,
                    providerMessageID: nil,
                    sentAt: nil
                ),
                origin: .real
            )
        )
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.loadDraft()

        model.beginReview(displayedContent: model.draft!.content)
        await model.requestConfirmation()
        await model.sendConfirmedDraft()
        model.beginReview(displayedContent: model.draft!.content)
        await model.requestConfirmation()
        await model.sendConfirmedDraft()

        XCTAssertEqual(client.sendCalls.count, 2)
        XCTAssertNotEqual(
            client.sendCalls[0].idempotencyKey,
            client.sendCalls[1].idempotencyKey
        )
    }

    func testExplicitFailedSendIsNotReportedUnknown() async {
        let client = configuredClient()
        client.sendResult = .success(
            .init(
                value: .init(
                    draftID: "private-draft",
                    provider: .feishu,
                    status: .failed,
                    providerMessageID: nil,
                    sentAt: nil
                ),
                origin: .real
            )
        )
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.loadDraft()
        model.beginReview(displayedContent: model.draft!.content)
        await model.requestConfirmation()
        await model.sendConfirmedDraft()

        XCTAssertEqual(model.sendState, .failed("发送失败，请检查渠道状态后重试。"))
    }

    func testSentDraftCannotBeUnlockedByEditReloadOrReopen() async {
        let client = configuredClient()
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.loadDraft()
        model.beginReview(displayedContent: model.draft!.content)
        await model.requestConfirmation()
        await model.sendConfirmedDraft()
        XCTAssertEqual(model.sendState, .sent)

        await model.updateDraft(content: "must not unlock")
        await model.loadDraft()
        model.closeItem()
        await model.open(row.id)
        await model.loadDraft()
        model.beginReview(displayedContent: model.draft!.content)

        XCTAssertEqual(model.sendState, .sent)
        XCTAssertEqual(client.sendCalls.count, 1)
        XCTAssertTrue(client.draftUpdates.isEmpty)
    }

    func testOpenRefreshesDetailFromServer() async {
        let client = configuredClient()
        client.itemResult = .success(
            .init(value: Self.item(id: "private-item", revision: 11), origin: .real)
        )
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)

        await model.open(row.id)

        XCTAssertEqual(model.selectedItem?.revision, 11)
    }

    func testEditWhileConfirmationIsInFlightCannotReviveOldToken() async {
        let client = configuredClient()
        let gate = ConfirmationGate()
        client.confirmationHandler = { try await gate.wait() }
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.loadDraft()
        model.beginReview(displayedContent: model.draft!.content)

        let confirmationTask = Task { await model.requestConfirmation() }
        while !(await gate.isWaiting) { await Task.yield() }
        await model.updateDraft(content: "new content")
        await gate.resume(
            .init(
                value: .init(
                    confirmationToken: "stale-confirmation",
                    expiresAt: "2099-07-25T01:00:00Z"
                ),
                origin: .real
            )
        )
        await confirmationTask.value

        XCTAssertEqual(model.sendState, .idle)
        XCTAssertEqual(model.draft?.version, 5)
    }

    func testUnsavedDisplayedTextCannotEnterReview() async {
        let client = configuredClient()
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.loadDraft()

        model.beginReview(displayedContent: "unsaved local text")
        await model.requestConfirmation()

        XCTAssertEqual(model.sendState, .idle)
        XCTAssertTrue(client.sendCalls.isEmpty)
    }

    func testExpiredConfirmationCannotSend() async {
        let client = configuredClient()
        client.confirmationResult = .success(
            .init(
                value: .init(
                    confirmationToken: "expired-confirmation",
                    expiresAt: "2000-01-01T00:00:00Z"
                ),
                origin: .real
            )
        )
        let model = UnifiedInboxViewModel(client: client)
        await model.load()
        let row = try! XCTUnwrap(model.items.first)
        await model.open(row.id)
        await model.loadDraft()
        model.beginReview(displayedContent: model.draft!.content)

        await model.requestConfirmation()
        await model.sendConfirmedDraft()

        XCTAssertEqual(model.sendState, .failed("发送确认已过期，请重新检查。"))
        XCTAssertTrue(client.sendCalls.isEmpty)
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
        client.confirmationResult = .success(.init(value: .init(confirmationToken: "confirmation-token", expiresAt: "2099-07-25T01:00:00Z"), origin: .real))
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
    var confirmationHandler: (() async throws -> UnifiedInboxResponse<InboxConfirmationResponse>)?
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
    func confirmation(draftID: String) async throws -> UnifiedInboxResponse<InboxConfirmationResponse> {
        if let confirmationHandler { return try await confirmationHandler() }
        return try confirmationResult.get()
    }
    func send(draftID: String, version: Int, confirmationToken: String, idempotencyKey: String) async throws -> UnifiedInboxResponse<InboxSendResultResponse> { sendCalls.append((version, idempotencyKey)); return try sendResult.get() }
}

private actor ConfirmationGate {
    typealias Response = UnifiedInboxResponse<InboxConfirmationResponse>
    private var continuation: CheckedContinuation<Response, Error>?

    var isWaiting: Bool { continuation != nil }

    func wait() async throws -> Response {
        try await withCheckedThrowingContinuation { continuation = $0 }
    }

    func resume(_ response: Response) {
        continuation?.resume(returning: response)
        continuation = nil
    }
}
