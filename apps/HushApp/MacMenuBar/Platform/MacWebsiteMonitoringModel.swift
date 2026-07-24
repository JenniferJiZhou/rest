import AppKit
import Foundation

@MainActor
final class MacWebsiteMonitoringModel: ObservableObject {
    struct WebsiteRecord: Codable, Identifiable {
        let domain: String
        var userProvidedName: String
        var dailySeconds: TimeInterval
        var lastVisitedAt: Date

        var id: String { domain }
    }

    private struct ContinuityState {
        let accumulatedSeconds: TimeInterval
        let leftAt: Date
    }

    private struct BrowserReadError: Error {
        let message: String
    }

    private struct WebsiteUsageRequest: Encodable {
        let schemaVersion = "1.0"
        let requestID: String
        let measuredAt: String
        let platform = "macos"
        let triggerSource = "macos_website_checkpoint"
        let targetType = "website"
        let websiteDomain: String
        let userProvidedContextLabel: String?
        let labelSource: String
        let dailyUsageMinutes: Int
        let continuousUsageMinutes: Int
        let continuousUsageIsEstimated = false
        let appSwitchesLast10Minutes: Int
        let localHour: Int
        let minutesSinceLastRest: Int
        let selfReportedEnergy: Int? = nil
        let recentFeedback: [String] = []
        let fullURLIncluded = false
        let pageTitleIncluded = false

        enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case requestID = "request_id"
            case measuredAt = "measured_at"
            case platform
            case triggerSource = "trigger_source"
            case targetType = "target_type"
            case websiteDomain = "website_domain"
            case userProvidedContextLabel = "user_provided_context_label"
            case labelSource = "label_source"
            case dailyUsageMinutes = "daily_usage_minutes"
            case continuousUsageMinutes = "continuous_usage_minutes"
            case continuousUsageIsEstimated =
                "continuous_usage_is_estimated"
            case appSwitchesLast10Minutes =
                "app_switches_last_10_minutes"
            case localHour = "local_hour"
            case minutesSinceLastRest = "minutes_since_last_rest"
            case selfReportedEnergy = "self_reported_energy"
            case recentFeedback = "recent_feedback"
            case fullURLIncluded = "full_url_included"
            case pageTitleIncluded = "page_title_included"
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

    @Published private(set) var isMonitoring = false
    @Published private(set) var currentBrowserName: String?
    @Published private(set) var currentDomain: String?
    @Published private(set) var continuousSeconds: TimeInterval = 0
    @Published private(set) var dailySeconds: TimeInterval = 0
    @Published private(set) var websites: [WebsiteRecord]
    @Published private(set) var monitoringStatus =
        "支持 Safari 和 Google Chrome。"
    @Published private(set) var uploadStatus = "网站域名自动上传已关闭。"
    @Published private(set) var lastRequestJSON: String?
    @Published private(set) var isSendingRequest = false
    @Published var automaticallyUploadDomains: Bool {
        didSet {
            defaults.set(
                automaticallyUploadDomains,
                forKey: Self.automaticallyUploadDomainsKey
            )
            uploadStatus = automaticallyUploadDomains
                ? "自动上传已开启；每连续 5 分钟检查一次。"
                : "网站域名自动上传已关闭。"
        }
    }

    private static let websitesKey = "mac.websites.records"
    private static let recordsDateKey = "mac.websites.recordsDate"
    private static let automaticallyUploadDomainsKey =
        "mac.websites.automaticallyUploadDomains"
    private static let agentBaseURLKey = "mac.agent.baseURL"
    private static let lastCompletedRestDateKey =
        "mac.rest.lastCompletedDate"
    private static let continuityGraceInterval: TimeInterval = 60
    private static let checkpointInterval: TimeInterval = 5 * 60
    private static let switchHistoryInterval: TimeInterval = 10 * 60
    private static let supportedBrowsers: [String: String] = [
        "com.apple.Safari": "Safari",
        "com.google.Chrome": "Google Chrome"
    ]

    private let workspace = NSWorkspace.shared
    private let defaults = UserDefaults.standard
    private var recordsDate: Date
    private var timer: Timer?
    private var activeDomain: String?
    private var activeStartedAt: Date?
    private var activeContinuousBase: TimeInterval = 0
    private var continuityStates: [String: ContinuityState] = [:]
    private var lastCheckpointNumber: [String: Int] = [:]
    private var switchDates: [Date] = []

    init() {
        if
            let data = defaults.data(forKey: Self.websitesKey),
            let stored = try? PropertyListDecoder().decode(
                [WebsiteRecord].self,
                from: data
            )
        {
            websites = stored
        } else {
            websites = []
        }

        recordsDate =
            defaults.object(forKey: Self.recordsDateKey) as? Date
            ?? Date()
        automaticallyUploadDomains = defaults.bool(
            forKey: Self.automaticallyUploadDomainsKey
        )
        resetDailyTotalsIfNeeded(now: Date())
        sortWebsites()
    }

    var currentContinuousDisplay: String {
        Self.durationDisplay(continuousSeconds)
    }

    var currentDailyDisplay: String {
        Self.durationDisplay(dailySeconds)
    }

    var currentWebsiteCanBeSent: Bool {
        currentDomain != nil
            && validAgentBaseURL != nil
            && lastCompletedRestDate != nil
            && !isSendingRequest
    }

    var frequentWebsites: [WebsiteRecord] {
        Array(
            websites
                .sorted {
                    if $0.dailySeconds == $1.dailySeconds {
                        return $0.lastVisitedAt > $1.lastVisitedAt
                    }
                    return $0.dailySeconds > $1.dailySeconds
                }
                .prefix(12)
        )
    }

    func startMonitoring() {
        guard !isMonitoring else {
            return
        }

        isMonitoring = true
        pollActiveWebsite(now: Date())
        timer = Timer.scheduledTimer(
            withTimeInterval: 1,
            repeats: true
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.pollActiveWebsite(now: Date())
            }
        }
    }

    func stopMonitoring() {
        guard isMonitoring else {
            return
        }

        commitActiveWebsite(at: Date(), preserveContinuity: false)
        timer?.invalidate()
        timer = nil
        isMonitoring = false
        currentBrowserName = nil
        currentDomain = nil
        activeDomain = nil
        activeStartedAt = nil
        activeContinuousBase = 0
        continuousSeconds = 0
        dailySeconds = 0
        continuityStates = [:]
        lastCheckpointNumber = [:]
        monitoringStatus = "网站监测已停止。"
    }

    func userProvidedName(for domain: String) -> String {
        websites.first { $0.domain == domain }?.userProvidedName ?? ""
    }

    func updateUserProvidedName(_ name: String, for domain: String) {
        guard let index = websites.firstIndex(where: { $0.domain == domain })
        else {
            return
        }

        websites[index].userProvidedName = name
        persistWebsites()
    }

    func forgetWebsite(_ domain: String) {
        if activeDomain == domain {
            transition(to: nil, browserName: currentBrowserName, now: Date())
        }
        websites.removeAll { $0.domain == domain }
        continuityStates.removeValue(forKey: domain)
        lastCheckpointNumber.removeValue(forKey: domain)
        persistWebsites()
    }

    func sendCurrentWebsite() {
        sendCurrentWebsite(now: Date(), automatic: false)
    }

    private func pollActiveWebsite(now: Date) {
        resetDailyTotalsIfNeeded(now: now)
        guard
            let application = workspace.frontmostApplication,
            let bundleIdentifier = application.bundleIdentifier,
            let browserName = Self.supportedBrowsers[bundleIdentifier]
        else {
            transition(to: nil, browserName: nil, now: now)
            monitoringStatus =
                "切换到 Safari 或 Google Chrome 后会自动识别域名。"
            return
        }

        currentBrowserName = browserName
        switch activeURLString(bundleIdentifier: bundleIdentifier) {
        case .success(let urlString):
            guard let domain = Self.normalizedDomain(from: urlString) else {
                transition(to: nil, browserName: browserName, now: now)
                monitoringStatus = "当前标签页没有可监测的网页域名。"
                return
            }
            transition(to: domain, browserName: browserName, now: now)
            monitoringStatus = "仅在本机读取并保存域名，不保存完整网址。"
        case .failure(let error):
            transition(to: nil, browserName: browserName, now: now)
            monitoringStatus = error.message
        }
    }

    private func transition(
        to domain: String?,
        browserName: String?,
        now: Date
    ) {
        guard domain != activeDomain else {
            refreshDurations(now: now)
            sendAutomaticCheckpointIfNeeded(now: now)
            return
        }

        let previousDomain = activeDomain
        commitActiveWebsite(at: now)
        continuityStates = continuityStates.filter {
            now.timeIntervalSince($0.value.leftAt)
                < Self.continuityGraceInterval
        }

        if previousDomain != nil, domain != nil {
            switchDates.append(now)
            pruneSwitchHistory(now: now)
        }

        currentBrowserName = browserName
        currentDomain = domain
        activeDomain = domain
        guard let domain else {
            activeStartedAt = nil
            activeContinuousBase = 0
            refreshDurations(now: now)
            return
        }

        registerWebsite(domain, now: now)
        activeStartedAt = now
        if
            let continuityState = continuityStates[domain],
            now.timeIntervalSince(continuityState.leftAt)
                < Self.continuityGraceInterval
        {
            activeContinuousBase = continuityState.accumulatedSeconds
        } else {
            activeContinuousBase = 0
            lastCheckpointNumber[domain] = 0
        }
        continuityStates.removeValue(forKey: domain)
        refreshDurations(now: now)
    }

    private func commitActiveWebsite(
        at now: Date,
        preserveContinuity: Bool = true
    ) {
        guard
            let domain = activeDomain,
            let activeStartedAt,
            let index = websites.firstIndex(where: { $0.domain == domain })
        else {
            return
        }

        let elapsed = max(0, now.timeIntervalSince(activeStartedAt))
        websites[index].dailySeconds += elapsed
        websites[index].lastVisitedAt = now
        if preserveContinuity {
            continuityStates[domain] = ContinuityState(
                accumulatedSeconds: activeContinuousBase + elapsed,
                leftAt: now
            )
        } else {
            continuityStates.removeValue(forKey: domain)
        }
        persistWebsites()
    }

    private func refreshDurations(now: Date) {
        guard
            let domain = activeDomain,
            let activeStartedAt,
            let record = websites.first(where: { $0.domain == domain })
        else {
            continuousSeconds = 0
            dailySeconds = 0
            return
        }

        let elapsed = max(0, now.timeIntervalSince(activeStartedAt))
        continuousSeconds = activeContinuousBase + elapsed
        dailySeconds = record.dailySeconds + elapsed
    }

    private func registerWebsite(_ domain: String, now: Date) {
        if let index = websites.firstIndex(where: { $0.domain == domain }) {
            websites[index].lastVisitedAt = now
        } else {
            websites.append(
                WebsiteRecord(
                    domain: domain,
                    userProvidedName: "",
                    dailySeconds: 0,
                    lastVisitedAt: now
                )
            )
        }
        sortWebsites()
        persistWebsites()
    }

    private func sendAutomaticCheckpointIfNeeded(now: Date) {
        guard automaticallyUploadDomains, let domain = activeDomain else {
            return
        }

        let checkpointNumber = Int(
            continuousSeconds / Self.checkpointInterval
        )
        guard
            checkpointNumber > 0,
            checkpointNumber
                > lastCheckpointNumber[domain, default: 0]
        else {
            return
        }

        lastCheckpointNumber[domain] = checkpointNumber
        sendCurrentWebsite(now: now, automatic: true)
    }

    private func sendCurrentWebsite(now: Date, automatic: Bool) {
        guard !isSendingRequest, let domain = activeDomain else {
            return
        }
        guard let baseURL = validAgentBaseURL else {
            uploadStatus = "请先在 Agent 卡片中填写有效的 HTTPS 地址。"
            return
        }
        guard let lastCompletedRestDate else {
            uploadStatus = "请先在 Agent 卡片中记录一次休息。"
            return
        }

        let customName = userProvidedName(for: domain)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        pruneSwitchHistory(now: now)
        let requestID = "req_mac_web_\(UUID().uuidString.lowercased())"
        let payload = WebsiteUsageRequest(
            requestID: requestID,
            measuredAt: ISO8601DateFormatter().string(from: now),
            websiteDomain: domain,
            userProvidedContextLabel:
                customName.isEmpty ? nil : customName,
            labelSource: customName.isEmpty ? "domain" : "user",
            dailyUsageMinutes: Int(dailySeconds / 60),
            continuousUsageMinutes: Int(continuousSeconds / 60),
            appSwitchesLast10Minutes: switchDates.count,
            localHour: Calendar.current.component(.hour, from: now),
            minutesSinceLastRest: max(
                0,
                Int(now.timeIntervalSince(lastCompletedRestDate) / 60)
            )
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let body = try? encoder.encode(payload) else {
            uploadStatus = "无法生成网站请求数据。"
            return
        }

        lastRequestJSON = String(data: body, encoding: .utf8)
        uploadStatus = automatic
            ? "网站达到 5 分钟检查点，正在请求 Agent…"
            : "正在发送当前网站数据…"
        isSendingRequest = true

        let endpoint = baseURL
            .appendingPathComponent("v1")
            .appendingPathComponent("rest")
            .appendingPathComponent("evaluate")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 5
        request.httpBody = body
        request.setValue(
            "application/json",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue(requestID, forHTTPHeaderField: "X-Request-ID")
        request.setValue("1.0.0", forHTTPHeaderField: "X-Client-Version")
        request.setValue("1.0", forHTTPHeaderField: "X-Contract-Version")

        Task {
            do {
                let (data, response) = try await URLSession.shared.data(
                    for: request
                )
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw URLError(.badServerResponse)
                }
                guard (200..<300).contains(httpResponse.statusCode) else {
                    uploadStatus =
                        "Agent 返回 HTTP \(httpResponse.statusCode)。"
                    isSendingRequest = false
                    return
                }

                let suggestion = try JSONDecoder().decode(
                    RestSuggestionResponse.self,
                    from: data
                )
                guard suggestion.requestID == requestID else {
                    uploadStatus = "Agent 响应的 request_id 不匹配。"
                    isSendingRequest = false
                    return
                }
                uploadStatus = suggestion.shouldOfferRest
                    ? "Agent 建议休息：\(suggestion.message)"
                    : "Agent 建议继续：\(suggestion.message)"
            } catch {
                uploadStatus =
                    "网站请求失败：\(error.localizedDescription)"
            }
            isSendingRequest = false
        }
    }

    private func activeURLString(
        bundleIdentifier: String
    ) -> Result<String, BrowserReadError> {
        let source: String
        switch bundleIdentifier {
        case "com.apple.Safari":
            source =
                """
                tell application "Safari"
                    if (count of windows) is 0 then return ""
                    return URL of current tab of front window
                end tell
                """
        case "com.google.Chrome":
            source =
                """
                tell application "Google Chrome"
                    if (count of windows) is 0 then return ""
                    return URL of active tab of front window
                end tell
                """
        default:
            return .failure(
                BrowserReadError(message: "当前浏览器暂不支持。")
            )
        }

        var error: NSDictionary?
        guard
            let result = NSAppleScript(source: source)?
                .executeAndReturnError(&error)
                .stringValue
        else {
            let detail =
                error?[NSAppleScript.errorMessage] as? String
                ?? "未获得浏览器自动化权限"
            return .failure(
                BrowserReadError(
                    message:
                        "无法读取浏览器域名：\(detail)。请在系统设置的“隐私与安全性 → 自动化”中允许 Hush。"
                )
            )
        }
        return .success(result)
    }

    private var validAgentBaseURL: URL? {
        guard
            let value = defaults.string(forKey: Self.agentBaseURLKey),
            let url = URL(
                string: value.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
            ),
            url.scheme?.lowercased() == "https",
            url.host != nil
        else {
            return nil
        }
        return url
    }

    private var lastCompletedRestDate: Date? {
        defaults.object(
            forKey: Self.lastCompletedRestDateKey
        ) as? Date
    }

    private func resetDailyTotalsIfNeeded(now: Date) {
        guard !Calendar.current.isDate(recordsDate, inSameDayAs: now)
        else {
            return
        }

        websites = websites.map {
            WebsiteRecord(
                domain: $0.domain,
                userProvidedName: $0.userProvidedName,
                dailySeconds: 0,
                lastVisitedAt: $0.lastVisitedAt
            )
        }
        recordsDate = now
        if let activeStartedAt {
            activeContinuousBase += max(
                0,
                now.timeIntervalSince(activeStartedAt)
            )
            self.activeStartedAt = now
        }
        persistWebsites()
    }

    private func pruneSwitchHistory(now: Date) {
        switchDates.removeAll {
            now.timeIntervalSince($0) > Self.switchHistoryInterval
        }
    }

    private func sortWebsites() {
        websites.sort {
            if $0.dailySeconds == $1.dailySeconds {
                return $0.lastVisitedAt > $1.lastVisitedAt
            }
            return $0.dailySeconds > $1.dailySeconds
        }
    }

    private func persistWebsites() {
        guard let data = try? PropertyListEncoder().encode(websites) else {
            return
        }
        defaults.set(data, forKey: Self.websitesKey)
        defaults.set(recordsDate, forKey: Self.recordsDateKey)
    }

    private static func normalizedDomain(from value: String) -> String? {
        guard
            let components = URLComponents(string: value),
            ["http", "https"].contains(
                components.scheme?.lowercased() ?? ""
            ),
            var host = components.host?.lowercased(),
            !host.isEmpty
        else {
            return nil
        }

        if host.hasPrefix("www.") {
            host.removeFirst(4)
        }
        return host
    }

    private static func durationDisplay(_ duration: TimeInterval) -> String {
        let totalSeconds = max(0, Int(duration))
        return String(
            format: "%d:%02d",
            totalSeconds / 60,
            totalSeconds % 60
        )
    }
}
