import Combine
import Foundation

enum UnifiedInboxMode: Sendable {
    case sample
    case real
}

enum UnifiedInboxLoadState: Equatable, Sendable {
    case idle
    case loading
    case loaded
    case empty
    case failed(String)
}

enum UnifiedInboxSendState: Equatable, Sendable {
    case idle
    case reviewing
    case confirming
    case sending
    case sent
    case failed(String)
    case unknown
}

struct UnifiedInboxReplyTarget: Equatable, Sendable {
    let displayName: String
    let reason: String
}

struct UnifiedInboxPresentedItem: Identifiable, Equatable, Sendable {
    let id: UUID
    let provider: InboxProviderResponse
    let sender: String?
    let conversationName: String
    let subject: String?
    let content: String?
    let receivedAt: String
    let summary: String?
    let importantPoints: [String]
    let todos: [String]
    let priority: InboxPriorityResponse
    let needsReply: Bool?
    let replyTargets: [UnifiedInboxReplyTarget]
    let revision: Int
    let messageCount: Int
    let acknowledgedAt: String?
    let hasDraft: Bool
}

struct UnifiedInboxPresentedDraft: Equatable, Sendable {
    let content: String
    let contentType: InboxContentTypeResponse
    let version: Int
    let origin: InboxDraftOriginResponse
    let status: InboxDraftStatusResponse
}

struct UnifiedInboxProviderReadiness: Equatable, Sendable {
    let provider: InboxProviderResponse
    let status: InboxSyncStateResponse
    let lastSyncedAt: String?
    let hasError: Bool
    let coverage: InboxCoverageResponse
}

@MainActor
protocol UnifiedInboxStoreProtocol: AnyObject {
    var mode: UnifiedInboxMode { get }
    var origin: UnifiedInboxDataOrigin? { get }
    func load() async
    func refresh() async
}

@MainActor
final class UnifiedInboxViewModel: ObservableObject, UnifiedInboxStoreProtocol {
    let mode: UnifiedInboxMode = .real

    @Published private(set) var origin: UnifiedInboxDataOrigin?
    @Published private(set) var loadState: UnifiedInboxLoadState = .idle
    @Published private(set) var sendState: UnifiedInboxSendState = .idle
    @Published private(set) var items: [UnifiedInboxPresentedItem] = []
    @Published private(set) var providerReadiness: [UnifiedInboxProviderReadiness] = []
    @Published private(set) var selectedItem: UnifiedInboxPresentedItem?
    @Published private(set) var draft: UnifiedInboxPresentedDraft?
    @Published private(set) var isAcknowledging = false
    @Published private(set) var isLoadingDraft = false
    @Published private(set) var isUpdatingDraft = false
    @Published private(set) var isRequestingConfirmation = false

    private let client: any UnifiedInboxClient
    private var transportIDs: [UUID: String] = [:]
    private var draftIDs: [UUID: String] = [:]
    private var selectedPresentationID: UUID?
    private var confirmationToken: String?
    private var confirmationExpiresAt: Date?
    private var reviewGeneration = 0
    private var terminalSendStates: [String: UnifiedInboxSendState] = [:]

    init(client: any UnifiedInboxClient) {
        self.client = client
    }

    var isMutationInFlight: Bool {
        isAcknowledging
            || isLoadingDraft
            || isUpdatingDraft
            || isRequestingConfirmation
            || sendState == .sending
    }

    func load() async {
        loadState = .loading
        origin = nil
        do {
            let statusResponse = try await client.syncStatuses()
            try accept(statusResponse.origin)
            providerReadiness = statusResponse.value.map(Self.mapStatus)

            var allItems: [InboxItemResponse] = []
            var cursor: String?
            repeat {
                let response = try await client.listItems(cursor: cursor)
                try accept(response.origin)
                allItems.append(contentsOf: response.value.items)
                cursor = response.value.nextCursor
            } while cursor != nil

            replaceItems(with: allItems)
            if items.isEmpty {
                let available = providerReadiness.contains {
                    $0.status == .ready || $0.status == .degraded
                }
                loadState = available
                    ? .empty
                    : .failed("消息渠道当前不可用。")
            } else {
                loadState = .loaded
            }
        } catch {
            loadState = .failed(Self.message(for: error))
        }
    }

    func refresh() async {
        await load()
    }

    func open(_ presentationID: UUID) async {
        guard let transportID = transportIDs[presentationID] else { return }
        do {
            let response = try await client.item(id: transportID)
            try accept(response.origin)
            let presented = Self.mapItem(response.value, id: presentationID)
            selectedPresentationID = presentationID
            selectedItem = presented
            if let draftID = response.value.draftID {
                draftIDs[presentationID] = draftID
            }
            draft = nil
            invalidateConfirmation()
        } catch {
            loadState = .failed(Self.message(for: error))
        }
    }

    func closeItem() {
        selectedPresentationID = nil
        selectedItem = nil
        draft = nil
        invalidateConfirmation()
    }

    func acknowledgeSelected() async {
        guard
            !isAcknowledging,
            let presentationID = selectedPresentationID,
            let transportID = transportIDs[presentationID],
            let revision = selectedItem?.revision
        else { return }
        isAcknowledging = true
        defer { isAcknowledging = false }
        do {
            let response = try await client.acknowledge(
                id: transportID,
                revision: revision
            )
            try accept(response.origin)
            replace(response.value, presentationID: presentationID)
        } catch UnifiedInboxAPIError.versionConflict {
            invalidateConfirmation()
            await refreshSelectedItem(presentationID, transportID: transportID)
        } catch {
            loadState = .failed(Self.message(for: error))
        }
    }

    func loadDraft() async {
        guard
            !isLoadingDraft,
            let presentationID = selectedPresentationID,
            let draftID = draftIDs[presentationID]
        else { return }
        isLoadingDraft = true
        defer { isLoadingDraft = false }
        do {
            let response = try await client.draft(id: draftID)
            try accept(response.origin)
            draft = Self.mapDraft(response.value)
            invalidateConfirmation()
        } catch {
            sendState = .failed(Self.message(for: error))
        }
    }

    func updateDraft(content: String) async {
        guard
            !isUpdatingDraft,
            let presentationID = selectedPresentationID,
            let draftID = draftIDs[presentationID],
            let version = draft?.version,
            terminalSendStates[draftID] == nil
        else { return }
        isUpdatingDraft = true
        defer { isUpdatingDraft = false }
        invalidateConfirmation()
        do {
            let response = try await client.updateDraft(
                id: draftID,
                content: content,
                version: version
            )
            try accept(response.origin)
            draft = Self.mapDraft(response.value)
        } catch UnifiedInboxAPIError.versionConflict {
            await refreshDraft(draftID)
        } catch {
            sendState = .failed(Self.message(for: error))
        }
    }

    func beginReview(displayedContent: String) {
        guard
            let draft,
            displayedContent == draft.content
        else { return }
        switch sendState {
        case .idle, .failed:
            break
        default:
            return
        }
        invalidateConfirmation()
        sendState = .reviewing
    }

    func requestConfirmation() async {
        guard
            !isRequestingConfirmation,
            sendState == .reviewing,
            let presentationID = selectedPresentationID,
            let draftID = draftIDs[presentationID],
            let reviewedVersion = draft?.version
        else { return }
        isRequestingConfirmation = true
        defer { isRequestingConfirmation = false }
        let generation = reviewGeneration
        do {
            let response = try await client.confirmation(draftID: draftID)
            try accept(response.origin)
            guard
                generation == reviewGeneration,
                selectedPresentationID == presentationID,
                draft?.version == reviewedVersion,
                sendState == .reviewing
            else { return }
            guard
                let expiresAt = ISO8601DateFormatter().date(
                    from: response.value.expiresAt
                ),
                expiresAt > Date()
            else {
                invalidateConfirmation()
                sendState = .failed("发送确认已过期，请重新检查。")
                return
            }
            confirmationToken = response.value.confirmationToken
            confirmationExpiresAt = expiresAt
            sendState = .confirming
        } catch {
            sendState = .failed(Self.message(for: error))
        }
    }

    func sendConfirmedDraft() async {
        guard
            sendState == .confirming,
            let presentationID = selectedPresentationID,
            let draftID = draftIDs[presentationID],
            let version = draft?.version,
            let token = confirmationToken,
            let expiresAt = confirmationExpiresAt
        else { return }
        guard expiresAt > Date() else {
            invalidateConfirmation()
            sendState = .failed("发送确认已过期，请重新检查。")
            return
        }
        confirmationToken = nil
        confirmationExpiresAt = nil
        sendState = .sending
        do {
            let response = try await client.send(
                draftID: draftID,
                version: version,
                confirmationToken: token,
                idempotencyKey: UUID().uuidString
            )
            try accept(response.origin)
            switch response.value.status {
            case .sent:
                terminalSendStates[draftID] = .sent
                sendState = .sent
            case .failed: sendState = .failed("发送失败，请检查渠道状态后重试。")
            case .unknown:
                terminalSendStates[draftID] = .unknown
                sendState = .unknown
            }
        } catch UnifiedInboxAPIError.versionConflict {
            await refreshDraft(draftID)
        } catch UnifiedInboxAPIError.server(let response) {
            _ = response
            sendState = .failed("服务器拒绝了发送请求。")
        } catch {
            terminalSendStates[draftID] = .unknown
            sendState = .unknown
        }
    }

    private func accept(_ responseOrigin: UnifiedInboxDataOrigin) throws {
        guard responseOrigin == .real else {
            throw StoreError.nonRealOrigin
        }
        if let origin, origin != responseOrigin {
            throw StoreError.mixedOrigins
        }
        origin = responseOrigin
    }

    private func replaceItems(with values: [InboxItemResponse]) {
        transportIDs.removeAll(keepingCapacity: true)
        draftIDs.removeAll(keepingCapacity: true)
        items = values.map { value in
            let presentationID = UUID()
            transportIDs[presentationID] = value.id
            if let draftID = value.draftID {
                draftIDs[presentationID] = draftID
            }
            return Self.mapItem(value, id: presentationID)
        }
        selectedPresentationID = nil
        selectedItem = nil
        draft = nil
        invalidateConfirmation()
    }

    private func replace(
        _ value: InboxItemResponse,
        presentationID: UUID
    ) {
        let presented = Self.mapItem(value, id: presentationID)
        if let index = items.firstIndex(where: { $0.id == presentationID }) {
            items[index] = presented
        }
        selectedItem = presented
        if let draftID = value.draftID {
            draftIDs[presentationID] = draftID
        }
    }

    private func refreshSelectedItem(_ id: UUID, transportID: String) async {
        do {
            let response = try await client.item(id: transportID)
            try accept(response.origin)
            replace(response.value, presentationID: id)
            invalidateConfirmation()
        } catch {
            loadState = .failed(Self.message(for: error))
        }
    }

    private func refreshDraft(_ id: String) async {
        do {
            let response = try await client.draft(id: id)
            try accept(response.origin)
            draft = Self.mapDraft(response.value)
            invalidateConfirmation()
        } catch {
            sendState = .failed(Self.message(for: error))
        }
    }

    private func invalidateConfirmation() {
        reviewGeneration += 1
        confirmationToken = nil
        confirmationExpiresAt = nil
        if
            let presentationID = selectedPresentationID,
            let draftID = draftIDs[presentationID],
            let terminalState = terminalSendStates[draftID]
        {
            sendState = terminalState
        } else {
            sendState = .idle
        }
    }

    private static func mapItem(
        _ value: InboxItemResponse,
        id: UUID
    ) -> UnifiedInboxPresentedItem {
        UnifiedInboxPresentedItem(
            id: id,
            provider: value.provider,
            sender: value.sender,
            conversationName: value.conversationName,
            subject: value.subject,
            content: value.content,
            receivedAt: value.receivedAt,
            summary: value.summary,
            importantPoints: value.importantPoints,
            todos: value.todos,
            priority: value.priority,
            needsReply: value.needsReply,
            replyTargets: value.replyTargets.map {
                UnifiedInboxReplyTarget(
                    displayName: $0.displayName,
                    reason: $0.reason
                )
            },
            revision: value.revision,
            messageCount: value.messageCount,
            acknowledgedAt: value.acknowledgedAt,
            hasDraft: value.draftID != nil
        )
    }

    private static func mapDraft(
        _ value: InboxDraftResponse
    ) -> UnifiedInboxPresentedDraft {
        UnifiedInboxPresentedDraft(
            content: value.content,
            contentType: value.contentType,
            version: value.version,
            origin: value.origin,
            status: value.status
        )
    }

    private static func mapStatus(
        _ value: InboxSyncStatusResponse
    ) -> UnifiedInboxProviderReadiness {
        UnifiedInboxProviderReadiness(
            provider: value.provider,
            status: value.status,
            lastSyncedAt: value.lastSyncedAt,
            hasError: value.lastError != nil,
            coverage: value.coverage
        )
    }

    private static func message(for error: Error) -> String {
        if case UnifiedInboxAPIError.server = error {
            return "消息服务拒绝了请求。"
        }
        if case StoreError.mixedOrigins = error {
            return "服务器返回了不一致的数据来源，已停止展示。"
        }
        if case StoreError.nonRealOrigin = error {
            return "服务器未返回真实数据，已停止展示。"
        }
        return "无法连接消息服务，请检查连接后重试。"
    }

    private enum StoreError: Error {
        case mixedOrigins
        case nonRealOrigin
    }
}
