import Foundation
import UserNotifications

@MainActor
final class AgentConnectionSettingsModel: ObservableObject {
    @Published var baseURL: String {
        didSet {
            defaults?.set(baseURL.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Self.baseURLKey)
        }
    }

    @Published private(set) var lastResultMessage: String?
    @Published private(set) var isRunningImmediateCloudTest = false

    private static let appGroupIdentifier = "group.com.JenniferJi.Hush"
    private static let baseURLKey = "agent.baseURL"
    private static let lastDecisionKey = "agent.lastDecisionMessage"
    private static let lastErrorKey = "agent.lastErrorMessage"

    private let defaults: UserDefaults?

    init() {
        let defaults = UserDefaults(suiteName: Self.appGroupIdentifier)
        self.defaults = defaults
        baseURL = defaults?.string(forKey: Self.baseURLKey) ?? ""
        refreshLastResult()
    }

    var isConfigured: Bool {
        guard
            let url = URL(
                string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            ),
            url.scheme?.lowercased() == "https",
            url.host != nil
        else {
            return false
        }

        return true
    }

    var statusMessage: String {
        if baseURL.isEmpty {
            return "填写 HTTPS 服务地址后才能启动。"
        }

        if !isConfigured {
            return "服务地址必须是有效的 HTTPS 地址。"
        }

        return "云端 Agent 已配置。每个 App 的名称来自你的主动填写。"
    }

    func refreshLastResult() {
        if let error = defaults?.string(forKey: Self.lastErrorKey) {
            lastResultMessage = "最近请求：\(error)"
        } else if let decision = defaults?.string(forKey: Self.lastDecisionKey) {
            lastResultMessage = decision.isEmpty
                ? "最近请求成功，Agent 建议继续观察。"
                : "最近决策：\(decision)"
        } else {
            lastResultMessage = nil
        }
    }

    func runImmediateCloudTest() async {
        guard !isRunningImmediateCloudTest else {
            return
        }
        guard
            let baseURL = URL(
                string: baseURL.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
            ),
            baseURL.scheme?.lowercased() == "https",
            baseURL.host != nil
        else {
            lastResultMessage = "快速测试失败：请先填写有效的 HTTPS 地址。"
            return
        }

        let notificationSettings =
            await UNUserNotificationCenter.current().notificationSettings()
        guard
            notificationSettings.authorizationStatus == .authorized
                || notificationSettings.authorizationStatus == .provisional
                || notificationSettings.authorizationStatus == .ephemeral
        else {
            lastResultMessage = "快速测试失败：请先启用休息提醒通知。"
            return
        }

        isRunningImmediateCloudTest = true
        defer {
            isRunningImmediateCloudTest = false
        }

        let requestID =
            "req_ios_manual_\(UUID().uuidString.lowercased())"
        let now = Date()
        let payload = ImmediateCloudTestRequest(
            requestID: requestID,
            measuredAt: ISO8601DateFormatter().string(from: now),
            localHour: Calendar.current.component(.hour, from: now)
        )
        let endpoint = baseURL
            .appendingPathComponent("v1")
            .appendingPathComponent("rest")
            .appendingPathComponent("evaluate")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.httpBody = try? JSONEncoder().encode(payload)
        request.setValue(
            "application/json",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue(requestID, forHTTPHeaderField: "X-Request-ID")
        request.setValue("1.0.0", forHTTPHeaderField: "X-Client-Version")
        request.setValue("1.0", forHTTPHeaderField: "X-Contract-Version")

        do {
            let (data, response) = try await URLSession.shared.data(
                for: request
            )
            guard
                let httpResponse = response as? HTTPURLResponse,
                (200..<300).contains(httpResponse.statusCode)
            else {
                let statusCode =
                    (response as? HTTPURLResponse)?.statusCode ?? 0
                lastResultMessage =
                    "快速测试失败：Agent 返回 HTTP \(statusCode)。"
                return
            }

            let suggestion = try JSONDecoder().decode(
                ImmediateCloudTestResponse.self,
                from: data
            )
            guard suggestion.requestID == requestID else {
                lastResultMessage =
                    "快速测试失败：Agent 响应的 request_id 不匹配。"
                return
            }
            guard suggestion.shouldOfferRest else {
                lastResultMessage =
                    "云端请求成功，但 Agent 本次选择继续工作。"
                return
            }

            let routedSuggestion = HushIOSRestSuggestion(
                requestID: suggestion.requestID,
                message: suggestion.message,
                questID: suggestion.defaultQuestID
            )
            let content = UNMutableNotificationContent()
            content.title = "Hush 提醒你休息一下"
            content.body = suggestion.message.isEmpty
                ? "有一个很短的休息任务在等你。"
                : suggestion.message
            content.sound = .default
            content.userInfo =
                HushIOSRestSuggestionRouting.userInfo(
                    for: routedSuggestion
                )
            let notification = UNNotificationRequest(
                identifier: "hush-cloud-test-\(requestID)",
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(
                    timeInterval: 1,
                    repeats: false
                )
            )
            try await UNUserNotificationCenter.current().add(notification)
            lastResultMessage =
                "云端请求成功；测试通知将在 1 秒后出现。"
        } catch {
            lastResultMessage =
                "快速测试失败：\(error.localizedDescription)"
        }
    }
}

private struct ImmediateCloudTestRequest: Encodable {
    let schemaVersion = "1.0"
    let requestID: String
    let measuredAt: String
    let platform = "ios"
    let triggerSource = "manual_ios"
    let continuousScreenMinutes: Int? = nil
    let appSwitchesLast10Minutes: Int? = nil
    let localHour: Int
    let minutesSinceLastRest = 96
    let selfReportedEnergy = 3
    let recentFeedback: [String] = []
    let rawAppNamesIncluded = false

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case requestID = "request_id"
        case measuredAt = "measured_at"
        case platform
        case triggerSource = "trigger_source"
        case continuousScreenMinutes = "continuous_screen_minutes"
        case appSwitchesLast10Minutes =
            "app_switches_last_10_minutes"
        case localHour = "local_hour"
        case minutesSinceLastRest = "minutes_since_last_rest"
        case selfReportedEnergy = "self_reported_energy"
        case recentFeedback = "recent_feedback"
        case rawAppNamesIncluded = "raw_app_names_included"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(requestID, forKey: .requestID)
        try container.encode(measuredAt, forKey: .measuredAt)
        try container.encode(platform, forKey: .platform)
        try container.encode(triggerSource, forKey: .triggerSource)
        try container.encodeNil(forKey: .continuousScreenMinutes)
        try container.encodeNil(forKey: .appSwitchesLast10Minutes)
        try container.encode(localHour, forKey: .localHour)
        try container.encode(
            minutesSinceLastRest,
            forKey: .minutesSinceLastRest
        )
        try container.encode(
            selfReportedEnergy,
            forKey: .selfReportedEnergy
        )
        try container.encode(recentFeedback, forKey: .recentFeedback)
        try container.encode(
            rawAppNamesIncluded,
            forKey: .rawAppNamesIncluded
        )
    }
}

private struct ImmediateCloudTestResponse: Decodable {
    let requestID: String
    let shouldOfferRest: Bool
    let message: String
    let defaultQuestID: String?

    enum CodingKeys: String, CodingKey {
        case requestID = "request_id"
        case shouldOfferRest = "should_offer_rest"
        case message
        case defaultQuestID = "default_quest_id"
    }
}
