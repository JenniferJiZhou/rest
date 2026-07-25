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
