import Foundation

struct GeneratedRestTask: Codable, Equatable, Sendable {
    let title: String
    let durationSeconds: Int
    let steps: [String]

    enum CodingKeys: String, CodingKey {
        case title
        case durationSeconds = "duration_seconds"
        case steps
    }

    var questContent: HushQuestContent {
        HushQuestContent(
            id: "generated-rest-task",
            contentVersion: "dynamic-rest-decision-v1.1",
            title: title,
            fatigueTypes: [],
            durationSeconds: durationSeconds,
            energyRequired: "unknown",
            locationTags: [],
            timeTags: [],
            steps: steps,
            requiresScreen: false,
            safetyNote: nil,
            anchorCompatible: false
        )
    }
}

struct HushDynamicRestSuggestion: Equatable, Sendable {
    let requestID: String
    let message: String
    let generatedTask: GeneratedRestTask
}

struct HushManualRestContext: Equatable, Sendable {
    let sessionID: String
    let fatigueType: String
    let userPreference: String?
    let availableMinutes: Int
    let source: String
    let locationTags: [String]
}

@MainActor
protocol HushManualRestTaskProviding {
    func generateTask(
        context: HushManualRestContext
    ) async throws -> HushDynamicRestSuggestion
}

@MainActor
final class HTTPManualRestTaskProvider: HushManualRestTaskProviding {
    enum ProviderError: Error {
        case invalidBaseURL
        case invalidResponse
        case requestFailed
    }

    private let baseURL: URL
    private let session: URLSession

    init(baseURLString: String) throws {
        let trimmed = baseURLString.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard
            let baseURL = URL(string: trimmed),
            baseURL.scheme?.lowercased() == "https",
            baseURL.host != nil
        else {
            throw ProviderError.invalidBaseURL
        }

        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 35
        configuration.timeoutIntervalForResource = 35
        session = URLSession(configuration: configuration)
    }

    static var automatic: HTTPManualRestTaskProvider? {
        #if os(iOS)
        let value = UserDefaults(
            suiteName: "group.com.JenniferJi.Hush"
        )?.string(forKey: "agent.baseURL")
        #else
        let value = UserDefaults.standard.string(
            forKey: "mac.agent.baseURL"
        )
        #endif
        guard let value else {
            return nil
        }
        return try? HTTPManualRestTaskProvider(baseURLString: value)
    }

    func generateTask(
        context: HushManualRestContext
    ) async throws -> HushDynamicRestSuggestion {
        let requestID =
            "req_manual_rest_\(UUID().uuidString.lowercased())"
        let body = ManualRestRequest(
            schemaVersion: "1.1",
            requestID: requestID,
            sessionID: context.sessionID,
            fatigueType: context.fatigueType,
            userPreference: context.userPreference,
            availableMinutes: context.availableMinutes,
            source: context.source,
            locationTags: context.locationTags
        )
        let endpoint = baseURL
            .appendingPathComponent("v1")
            .appendingPathComponent("rest")
            .appendingPathComponent("recommend")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 35
        request.httpBody = try JSONEncoder().encode(body)
        request.setValue(
            "application/json",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue(requestID, forHTTPHeaderField: "X-Request-ID")
        request.setValue(
            Bundle.main.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String ?? "unknown-apple-client",
            forHTTPHeaderField: "X-Client-Version"
        )
        request.setValue("1.1", forHTTPHeaderField: "X-Contract-Version")

        let (data, response) = try await session.data(for: request)
        guard
            let httpResponse = response as? HTTPURLResponse,
            (200..<300).contains(httpResponse.statusCode),
            httpResponse.value(
                forHTTPHeaderField: "X-Contract-Version"
            ) == "1.1",
            httpResponse.value(
                forHTTPHeaderField: "X-Request-ID"
            ) == requestID
        else {
            throw ProviderError.requestFailed
        }
        let result = try JSONDecoder().decode(
            ManualRestResponse.self,
            from: data
        )
        guard
            result.schemaVersion == "1.1",
            result.requestID == requestID,
            result.defaultQuestID == nil,
            result.actions == [
                "start_rest_session",
                "remind_later",
                "dismiss"
            ]
        else {
            throw ProviderError.invalidResponse
        }
        return HushDynamicRestSuggestion(
            requestID: result.requestID,
            message: result.message,
            generatedTask: result.generatedTask
        )
    }
}

private struct ManualRestRequest: Encodable {
    let schemaVersion: String
    let requestID: String
    let sessionID: String
    let fatigueType: String
    let userPreference: String?
    let availableMinutes: Int
    let source: String
    let locationTags: [String]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case requestID = "request_id"
        case sessionID = "session_id"
        case fatigueType = "fatigue_type"
        case userPreference = "user_preference"
        case availableMinutes = "available_minutes"
        case source
        case locationTags = "location_tags"
    }
}

private struct ManualRestResponse: Decodable {
    let schemaVersion: String
    let requestID: String
    let message: String
    let generatedTask: GeneratedRestTask
    let defaultQuestID: String?
    let actions: [String]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case requestID = "request_id"
        case message
        case generatedTask = "generated_task"
        case defaultQuestID = "default_quest_id"
        case actions
    }
}

extension Notification.Name {
    static let hushDynamicRestSuggestionOpened = Notification.Name(
        "hush.dynamic-rest-suggestion-opened"
    )
    static let hushRestTaskGenerationStarted = Notification.Name(
        "hush.rest-task-generation-started"
    )
    static let hushRestTaskGenerationFinished = Notification.Name(
        "hush.rest-task-generation-finished"
    )
    static let hushCompanionMessageUpdated = Notification.Name(
        "hush.companion-message-updated"
    )
}

struct HushQuestContent: Codable, Equatable, Identifiable {
    let id: String
    let contentVersion: String
    let title: String
    let fatigueTypes: [String]
    let durationSeconds: Int
    let energyRequired: String
    let locationTags: [String]
    let timeTags: [String]
    let steps: [String]
    let requiresScreen: Bool
    let safetyNote: String?
    let anchorCompatible: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case contentVersion = "content_version"
        case title
        case fatigueTypes = "fatigue_types"
        case durationSeconds = "duration_seconds"
        case energyRequired = "energy_required"
        case locationTags = "location_tags"
        case timeTags = "time_tags"
        case steps
        case requiresScreen = "requires_screen"
        case safetyNote = "safety_note"
        case anchorCompatible = "anchor_compatible"
    }

    var durationLabel: String {
        let minutes = max(1, Int(ceil(Double(durationSeconds) / 60)))
        return "\(minutes) 分钟"
    }

    static let emergencyFallback = HushQuestContent(
        id: "look_far_emergency",
        contentVersion: "fallback-1",
        title: "把视线放远一点",
        fatigueTypes: ["unknown"],
        durationSeconds: 60,
        energyRequired: "very_low",
        locationTags: ["any"],
        timeTags: ["any"],
        steps: [
            "把屏幕扣下或移开视线",
            "看向房间里最远的安全位置",
            "让眼睛停在那里一分钟"
        ],
        requiresScreen: false,
        safetyNote: nil,
        anchorCompatible: false
    )
}

struct HushDriftPrompt: Codable, Equatable, Identifiable {
    let id: String
    let category: String
    let text: String
}

struct HushBlueBoxCard: Codable, Equatable, Identifiable {
    let id: String
    let context: [String]
    let durationSeconds: Int
    let title: String
    let steps: [String]
    let medicalClaims: Bool
    let reviewedByBluebox: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case context
        case durationSeconds = "duration_seconds"
        case title
        case steps
        case medicalClaims = "medical_claims"
        case reviewedByBluebox = "reviewed_by_bluebox"
    }

    static let placeholder = HushBlueBoxCard(
        id: "supported_body_scan_fallback",
        context: ["bedtime_arousal"],
        durationSeconds: 300,
        title: "感受身体被托住的位置",
        steps: [
            "把手机放到一边",
            "注意头、肩膀和背部被托住的位置",
            "不需要主动改变呼吸"
        ],
        medicalClaims: false,
        reviewedByBluebox: false
    )
}

struct HushContentManifest: Codable, Equatable {
    let version: String
    let restQuests: String
    let driftPrompts: String
    let blueboxCards: String

    enum CodingKeys: String, CodingKey {
        case version
        case restQuests = "rest_quests"
        case driftPrompts = "drift_prompts"
        case blueboxCards = "bluebox_cards"
    }
}

protocol HushRestContentProviding {
    func loadManifest() throws -> HushContentManifest
    func loadQuests() throws -> [HushQuestContent]
    func loadDriftPrompts() throws -> [HushDriftPrompt]
    func loadBlueBoxCards() throws -> [HushBlueBoxCard]
}

enum HushContentError: LocalizedError {
    case missingResource(String)
    case emptyCollection(String)

    var errorDescription: String? {
        switch self {
        case let .missingResource(name):
            return "找不到本地内容：\(name).json"
        case let .emptyCollection(name):
            return "本地内容为空：\(name)"
        }
    }
}

struct BundledHushRestContentProvider: HushRestContentProviding {
    let bundle: Bundle
    let contentRootURL: URL?

    init(bundle: Bundle = .main, contentRootURL: URL? = nil) {
        self.bundle = bundle
        self.contentRootURL = contentRootURL
    }

    static var automatic: BundledHushRestContentProvider {
        let environmentRoot = ProcessInfo.processInfo.environment["HUSH_CONTENT_ROOT"]
            .map { URL(fileURLWithPath: $0, isDirectory: true) }
        return BundledHushRestContentProvider(contentRootURL: environmentRoot)
    }

    func loadManifest() throws -> HushContentManifest {
        try decode(HushContentManifest.self, resource: "content-manifest")
    }

    func loadQuests() throws -> [HushQuestContent] {
        let quests = try decode([HushQuestContent].self, resource: "rest-quests")
        guard !quests.isEmpty else { throw HushContentError.emptyCollection("rest-quests") }
        return quests
    }

    func loadDriftPrompts() throws -> [HushDriftPrompt] {
        let library = try decode(HushDriftLibrary.self, resource: "drift-prompts")
        guard !library.prompts.isEmpty else { throw HushContentError.emptyCollection("drift-prompts") }
        return library.prompts
    }

    func loadBlueBoxCards() throws -> [HushBlueBoxCard] {
        let library = try decode(HushBlueBoxLibrary.self, resource: "bluebox-cards")
        guard !library.cards.isEmpty else { throw HushContentError.emptyCollection("bluebox-cards") }
        return library.cards
    }

    private func decode<T: Decodable>(_ type: T.Type, resource: String) throws -> T {
        let explicitURL = contentRootURL?.appendingPathComponent("\(resource).json")
        let bundleURL = bundle.url(forResource: resource, withExtension: "json")

        guard let url = explicitURL ?? bundleURL else {
            throw HushContentError.missingResource(resource)
        }

        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(type, from: data)
    }
}

private struct HushDriftLibrary: Decodable {
    let version: String
    let prompts: [HushDriftPrompt]
    let privacy: String
}

private struct HushBlueBoxLibrary: Decodable {
    let version: String
    let status: String
    let cards: [HushBlueBoxCard]
}

struct HushDemoContentSnapshot {
    enum Status: Equatable {
        case ready
        case fallback(String)

        var isFallback: Bool {
            if case .fallback = self { return true }
            return false
        }

        var message: String? {
            if case let .fallback(message) = self { return message }
            return nil
        }
    }

    let manifest: HushContentManifest?
    let quests: [HushQuestContent]
    let driftPrompts: [HushDriftPrompt]
    let blueBoxCards: [HushBlueBoxCard]
    let status: Status

    static func load(from provider: any HushRestContentProviding) -> HushDemoContentSnapshot {
        do {
            return HushDemoContentSnapshot(
                manifest: try provider.loadManifest(),
                quests: try provider.loadQuests(),
                driftPrompts: try provider.loadDriftPrompts(),
                blueBoxCards: try provider.loadBlueBoxCards(),
                status: .ready
            )
        } catch {
            return HushDemoContentSnapshot(
                manifest: nil,
                quests: [.emergencyFallback],
                driftPrompts: [
                    HushDriftPrompt(
                        id: "fallback_far_sound",
                        category: "sense",
                        text: "此刻房间里最远的声音是什么？"
                    )
                ],
                blueBoxCards: [.placeholder],
                status: .fallback(error.localizedDescription)
            )
        }
    }
}
