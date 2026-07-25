import XCTest
@testable import Hush

@MainActor
final class UnifiedInboxModeCoordinatorTests: XCTestCase {
    func testConfiguredEnvironmentStartsDirectlyInRealWithoutPersistingToken() {
        let defaults = makeDefaults()
        let token = String(repeating: "t", count: 32)
        let coordinator = UnifiedInboxModeCoordinator(
            defaults: defaults,
            environment: [
                "HUSH_INBOX_BASE_URL": "https://inbox.example.com",
                "HUSH_APP_TOKEN": token
            ],
            clientFactory: { _ in FailingInboxClient() }
        )

        XCTAssertEqual(coordinator.selection, .real)
        XCTAssertNotNil(coordinator.realModel)
        XCTAssertTrue(coordinator.hasRuntimeToken)
        XCTAssertFalse(
            defaults.dictionaryRepresentation().values.contains {
                ($0 as? String) == token
            }
        )
    }

    func testMissingTokenStaysInConfigurationUntilSampleIsExplicit() {
        let defaults = makeDefaults()
        let coordinator = UnifiedInboxModeCoordinator(
            defaults: defaults,
            environment: ["HUSH_INBOX_BASE_URL": "https://inbox.example.com"],
            clientFactory: { _ in FailingInboxClient() }
        )

        XCTAssertEqual(coordinator.selection, .configuration)
        coordinator.selectSample()
        XCTAssertEqual(coordinator.selection, .sample)
    }

    func testRealFailureRemainsRealAndChangingURLClearsSession() async {
        let defaults = makeDefaults()
        let coordinator = UnifiedInboxModeCoordinator(
            defaults: defaults,
            environment: [
                "HUSH_INBOX_BASE_URL": "https://inbox.example.com",
                "HUSH_APP_TOKEN": String(repeating: "t", count: 32)
            ],
            clientFactory: { _ in FailingInboxClient() }
        )

        await coordinator.realModel?.load()
        XCTAssertEqual(coordinator.selection, .real)
        XCTAssertNotEqual(coordinator.realModel?.loadState, .idle)

        coordinator.updateBaseURL("https://other.example.com")
        XCTAssertEqual(coordinator.selection, .configuration)
        XCTAssertFalse(coordinator.hasRuntimeToken)
        XCTAssertNil(coordinator.realModel)
    }

    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: "UnifiedInboxModeCoordinatorTests.\(UUID().uuidString)")!
    }
}

private final class FailingInboxClient: UnifiedInboxClient, @unchecked Sendable {
    private var error: Error { URLError(.cannotConnectToHost) }
    func syncStatuses() async throws -> UnifiedInboxResponse<[InboxSyncStatusResponse]> { throw error }
    func listItems(cursor: String?) async throws -> UnifiedInboxResponse<InboxPageResponse> { throw error }
    func item(id: String) async throws -> UnifiedInboxResponse<InboxItemResponse> { throw error }
    func acknowledge(id: String, revision: Int) async throws -> UnifiedInboxResponse<InboxItemResponse> { throw error }
    func draft(id: String) async throws -> UnifiedInboxResponse<InboxDraftResponse> { throw error }
    func updateDraft(id: String, content: String, version: Int) async throws -> UnifiedInboxResponse<InboxDraftResponse> { throw error }
    func confirmation(draftID: String) async throws -> UnifiedInboxResponse<InboxConfirmationResponse> { throw error }
    func send(draftID: String, version: Int, confirmationToken: String, idempotencyKey: String) async throws -> UnifiedInboxResponse<InboxSendResultResponse> { throw error }
}
