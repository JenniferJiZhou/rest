import Foundation

protocol RestDecisionProviding {
    func evaluate(
        dailyAppUsageMinutes: Int,
        estimatedContinuousAppUsageMinutes: Int,
        contextLabel: String,
        minutesSinceLastRest: Int
    ) async throws -> RestDecision
}

struct RestDecision {
    let shouldOfferRest: Bool
    let message: String
}

final class HTTPRestDecisionProvider: RestDecisionProviding {
    enum ProviderError: Error {
        case invalidBaseURL
        case invalidResponse
        case requestFailed
    }

    private let baseURL: URL
    private let session: URLSession

    init(baseURLString: String) throws {
        guard
            let baseURL = URL(string: baseURLString),
            baseURL.scheme?.lowercased() == "https",
            baseURL.host != nil
        else {
            throw ProviderError.invalidBaseURL
        }

        self.baseURL = baseURL

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 5
        session = URLSession(configuration: configuration)
    }

    func evaluate(
        dailyAppUsageMinutes: Int,
        estimatedContinuousAppUsageMinutes: Int,
        contextLabel: String,
        minutesSinceLastRest: Int
    ) async throws -> RestDecision {
        let requestID = "req_ios_\(UUID().uuidString.lowercased())"
        let endpoint = baseURL
            .appendingPathComponent("v1")
            .appendingPathComponent("rest")
            .appendingPathComponent("evaluate")
        let payload = UsageSummaryRequest(
            schemaVersion: "1.0",
            requestID: requestID,
            measuredAt: ISO8601DateFormatter().string(from: Date()),
            platform: "ios",
            triggerSource: "device_activity_threshold",
            dailyAppUsageMinutes: dailyAppUsageMinutes,
            estimatedContinuousAppUsageMinutes:
                estimatedContinuousAppUsageMinutes,
            continuousUsageIsEstimated: true,
            appSwitchesLast10Minutes: nil,
            localHour: Calendar.current.component(.hour, from: Date()),
            minutesSinceLastRest: minutesSinceLastRest,
            selfReportedEnergy: nil,
            recentFeedback: [],
            userProvidedContextLabel: contextLabel,
            rawAppNamesIncluded: false
        )

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(requestID, forHTTPHeaderField: "X-Request-ID")
        request.setValue("1.0.0", forHTTPHeaderField: "X-Client-Version")
        request.setValue("1.0", forHTTPHeaderField: "X-Contract-Version")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard
            let httpResponse = response as? HTTPURLResponse,
            (200..<300).contains(httpResponse.statusCode)
        else {
            throw ProviderError.requestFailed
        }

        let suggestion = try JSONDecoder().decode(
            RestSuggestionResponse.self,
            from: data
        )
        guard suggestion.requestID == requestID else {
            throw ProviderError.invalidResponse
        }

        return RestDecision(
            shouldOfferRest: suggestion.shouldOfferRest,
            message: suggestion.message
        )
    }
}

private struct UsageSummaryRequest: Encodable {
    let schemaVersion: String
    let requestID: String
    let measuredAt: String
    let platform: String
    let triggerSource: String
    let dailyAppUsageMinutes: Int
    let estimatedContinuousAppUsageMinutes: Int
    let continuousUsageIsEstimated: Bool
    let appSwitchesLast10Minutes: Int?
    let localHour: Int
    let minutesSinceLastRest: Int
    let selfReportedEnergy: Int?
    let recentFeedback: [String]
    let userProvidedContextLabel: String
    let rawAppNamesIncluded: Bool

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case requestID = "request_id"
        case measuredAt = "measured_at"
        case platform
        case triggerSource = "trigger_source"
        case dailyAppUsageMinutes = "daily_app_usage_minutes"
        case estimatedContinuousAppUsageMinutes =
            "estimated_continuous_app_usage_minutes"
        case continuousUsageIsEstimated =
            "continuous_usage_is_estimated"
        case appSwitchesLast10Minutes = "app_switches_last_10_minutes"
        case localHour = "local_hour"
        case minutesSinceLastRest = "minutes_since_last_rest"
        case selfReportedEnergy = "self_reported_energy"
        case recentFeedback = "recent_feedback"
        case userProvidedContextLabel = "user_provided_context_label"
        case rawAppNamesIncluded = "raw_app_names_included"
    }
}

private struct RestSuggestionResponse: Decodable {
    let requestID: String
    let shouldOfferRest: Bool
    let message: String

    enum CodingKeys: String, CodingKey {
        case requestID = "request_id"
        case shouldOfferRest = "should_offer_rest"
        case message
    }
}
