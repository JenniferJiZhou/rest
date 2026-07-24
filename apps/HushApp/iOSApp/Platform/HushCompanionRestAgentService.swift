import Foundation

struct HushManualRestRecommendation {
    let quest: HushQuestContent
    let intro: String?
}

protocol HushCompanionRestAgentServing {
    func recommendManualRest(
        from snapshot: HushCompanionSnapshot,
        content: HushDemoContentSnapshot
    ) async throws -> HushManualRestRecommendation
}

struct HTTPHushCompanionRestAgentService:
    HushCompanionRestAgentServing
{
    enum ServiceError: LocalizedError {
        case missingBaseURL
        case invalidResponse
        case questUnavailable
        case requestFailed(Int)

        var errorDescription: String? {
            switch self {
            case .missingBaseURL:
                return "请先在设置中填写 Agent 的 HTTPS 地址。"
            case .invalidResponse:
                return "Agent 返回了无法识别的休息建议。"
            case .questUnavailable:
                return "Agent 推荐的休息内容不在当前内容库中。"
            case let .requestFailed(statusCode):
                return "Agent 暂时不可用（HTTP \(statusCode)）。"
            }
        }
    }

    private static let appGroupIdentifier = "group.com.JenniferJi.Hush"
    private static let baseURLKey = "agent.baseURL"

    private let session: URLSession

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 5
            configuration.timeoutIntervalForResource = 5
            self.session = URLSession(configuration: configuration)
        }
    }

    func recommendManualRest(
        from snapshot: HushCompanionSnapshot,
        content: HushDemoContentSnapshot
    ) async throws -> HushManualRestRecommendation {
        guard
            let storedURL = UserDefaults(
                suiteName: Self.appGroupIdentifier
            )?.string(forKey: Self.baseURLKey),
            let baseURL = URL(
                string: storedURL.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
            ),
            baseURL.scheme?.lowercased() == "https",
            baseURL.host != nil
        else {
            throw ServiceError.missingBaseURL
        }

        let requestID =
            "req_companion_manual_\(UUID().uuidString.lowercased())"
        let sessionID =
            "session_companion_\(UUID().uuidString.lowercased())"
        let manifestVersion =
            content.manifest?.version
            ?? content.quests.first?.contentVersion
            ?? HushQuestContent.emergencyFallback.contentVersion
        let allowedQuestIDs = content.quests.map(\.id)
        let payload = RecommendationRequest(
            schemaVersion: "1.0",
            requestID: requestID,
            sessionID: sessionID,
            contentVersion: manifestVersion,
            fatigueType: "unknown",
            userPreference: "surprise",
            availableMinutes: 3,
            source: "manual_ios",
            locationTags: ["any"],
            excludedQuestIDs: [],
            allowedQuestIDs: allowedQuestIDs
        )

        let endpoint = baseURL
            .appendingPathComponent("v1")
            .appendingPathComponent("rest")
            .appendingPathComponent("recommend")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue(
            "application/json",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue(requestID, forHTTPHeaderField: "X-Request-ID")
        request.setValue("1.0.0", forHTTPHeaderField: "X-Client-Version")
        request.setValue("1.0", forHTTPHeaderField: "X-Contract-Version")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ServiceError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw ServiceError.requestFailed(httpResponse.statusCode)
        }

        let recommendation = try JSONDecoder().decode(
            RecommendationResponse.self,
            from: data
        )
        guard
            recommendation.requestID == requestID,
            recommendation.contentVersion == manifestVersion
        else {
            throw ServiceError.invalidResponse
        }
        guard
            let quest = content.quests.first(
                where: { $0.id == recommendation.questID }
            )
        else {
            throw ServiceError.questUnavailable
        }

        return HushManualRestRecommendation(
            quest: quest,
            intro: recommendation.intro
        )
    }
}

private struct RecommendationRequest: Encodable {
    let schemaVersion: String
    let requestID: String
    let sessionID: String
    let contentVersion: String
    let fatigueType: String
    let userPreference: String?
    let availableMinutes: Int
    let source: String
    let locationTags: [String]
    let excludedQuestIDs: [String]
    let allowedQuestIDs: [String]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case requestID = "request_id"
        case sessionID = "session_id"
        case contentVersion = "content_version"
        case fatigueType = "fatigue_type"
        case userPreference = "user_preference"
        case availableMinutes = "available_minutes"
        case source
        case locationTags = "location_tags"
        case excludedQuestIDs = "excluded_quest_ids"
        case allowedQuestIDs = "allowed_quest_ids"
    }
}

private struct RecommendationResponse: Decodable {
    let requestID: String
    let contentVersion: String
    let questID: String
    let intro: String?

    enum CodingKeys: String, CodingKey {
        case requestID = "request_id"
        case contentVersion = "content_version"
        case questID = "quest_id"
        case intro
    }
}
