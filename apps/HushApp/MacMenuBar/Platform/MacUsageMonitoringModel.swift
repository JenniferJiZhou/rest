import AppKit
import Foundation

@MainActor
final class MacUsageMonitoringModel: ObservableObject {
    private struct ContinuityState {
        let accumulatedSeconds: TimeInterval
        let leftAt: Date
    }

    enum InterruptionMode: String, CaseIterable, Identifiable {
        case gentle
        case firm

        var id: String { rawValue }

        var title: String {
            switch self {
            case .gentle:
                return "柔和"
            case .firm:
                return "强提醒"
            }
        }
    }

    struct ApplicationIdentity: Codable, Hashable, Identifiable {
        let bundleIdentifier: String
        let systemDisplayName: String
        let bundleURL: URL?

        var id: String { bundleIdentifier }
    }

    struct MonitoredApplication: Codable, Hashable, Identifiable {
        let bundleIdentifier: String
        let systemDisplayName: String
        let bundleURL: URL?
        var userProvidedName: String

        var id: String { bundleIdentifier }
    }

    private struct UsageSummaryRequest: Encodable {
        let schemaVersion = "1.0"
        let requestID: String
        let measuredAt: String
        let platform = "macos"
        let triggerSource = "macos_usage_checkpoint"
        let userProvidedContextLabel: String
        let dailyAppUsageMinutes: Int
        let continuousAppUsageMinutes: Int
        let continuousScreenUsageMinutes: Int
        let continuousUsageIsEstimated = false
        let appSwitchesLast10Minutes: Int
        let localHour: Int
        let minutesSinceLastRest: Int
        let selfReportedEnergy: Int? = nil
        let recentFeedback: [String] = []
        let rawAppNamesIncluded = false

        enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case requestID = "request_id"
            case measuredAt = "measured_at"
            case platform
            case triggerSource = "trigger_source"
            case userProvidedContextLabel = "user_provided_context_label"
            case dailyAppUsageMinutes = "daily_app_usage_minutes"
            case continuousAppUsageMinutes =
                "continuous_app_usage_minutes"
            case continuousScreenUsageMinutes =
                "continuous_screen_usage_minutes"
            case continuousUsageIsEstimated =
                "continuous_usage_is_estimated"
            case appSwitchesLast10Minutes =
                "app_switches_last_10_minutes"
            case localHour = "local_hour"
            case minutesSinceLastRest = "minutes_since_last_rest"
            case selfReportedEnergy = "self_reported_energy"
            case recentFeedback = "recent_feedback"
            case rawAppNamesIncluded = "raw_app_names_included"
        }
    }

    private struct RestSuggestionResponse: Decodable {
        let requestID: String
        let shouldOfferRest: Bool
        let reasonCode: String
        let message: String
        let defaultQuestID: String?
        let generatedTask: GeneratedRestTask?

        enum CodingKeys: String, CodingKey {
            case requestID = "request_id"
            case shouldOfferRest = "should_offer_rest"
            case reasonCode = "reason_code"
            case message
            case defaultQuestID = "default_quest_id"
            case generatedTask = "generated_task"
        }
    }

    @Published private(set) var isMonitoring = false
    @Published private(set) var currentApplication: ApplicationIdentity?
    @Published private(set) var continuousSeconds: TimeInterval = 0
    @Published private(set) var continuousScreenSeconds: TimeInterval = 0
    @Published private(set) var currentDailySeconds: TimeInterval = 0
    @Published private(set) var discoveredApplications: [ApplicationIdentity] = []
    @Published private(set) var monitoredApplications: [MonitoredApplication]
    @Published var interruptionMode: InterruptionMode = .gentle
    @Published var agentBaseURL: String {
        didSet {
            defaults.set(
                agentBaseURL.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ),
                forKey: Self.agentBaseURLKey
            )
        }
    }
    @Published private(set) var agentStatusMessage = "尚未配置云端 Agent。"
    @Published private(set) var lastRequestJSON: String?
    @Published private(set) var lastCompletedRestDate: Date?
    @Published private(set) var isSendingAgentRequest = false

    private static let monitoredApplicationsKey =
        "mac.monitoring.monitoredApplications"
    private static let dailyTotalsKey = "mac.monitoring.dailyTotals"
    private static let dailyTotalsDateKey = "mac.monitoring.dailyTotalsDate"
    private static let agentBaseURLKey = "mac.agent.baseURL"
    private static let lastCompletedRestDateKey =
        "mac.rest.lastCompletedDate"
    private static let continuityGraceInterval: TimeInterval = 60
    private static let checkpointInterval: TimeInterval = 5 * 60
    private static let switchHistoryInterval: TimeInterval = 10 * 60
    private static let websiteMonitoredBrowserBundleIdentifiers: Set<String> = [
        "com.apple.Safari",
        "com.google.Chrome"
    ]

    private let workspace = NSWorkspace.shared
    private let defaults = UserDefaults.standard
    private var observers: [NSObjectProtocol] = []
    private var timer: Timer?
    private var activeBundleIdentifier: String?
    private var activeStartedAt: Date?
    private var activeContinuousBase: TimeInterval = 0
    private var screenContinuousStartedAt: Date?
    private var continuityStates: [String: ContinuityState] = [:]
    private var dailyTotals: [String: TimeInterval]
    private var dailyTotalsDate: Date
    private var switchDates: [Date] = []
    private var lastCheckpointNumber: [String: Int] = [:]
    private let companionSessionID = UUID().uuidString.lowercased()
    private var companionSequence = 0
    private var latestCompanionDecision: HushCompanionDecision?
    private var isCompanionResting = false
    private lazy var companionTransport = HushCompanionPeerTransport(
        role: .macBroadcaster,
        displayName: Host.current().localizedName ?? "Hush Mac"
    )

    init() {
        agentBaseURL = defaults.string(forKey: Self.agentBaseURLKey) ?? ""
        lastCompletedRestDate =
            defaults.object(forKey: Self.lastCompletedRestDateKey) as? Date

        if
            let data = defaults.data(
                forKey: Self.monitoredApplicationsKey
            ),
            let storedApplications = try? PropertyListDecoder().decode(
                [MonitoredApplication].self,
                from: data
            )
        {
            monitoredApplications = storedApplications
        } else {
            monitoredApplications = []
        }

        if
            let data = defaults.data(forKey: Self.dailyTotalsKey),
            let storedTotals = try? PropertyListDecoder().decode(
                [String: TimeInterval].self,
                from: data
            )
        {
            dailyTotals = storedTotals
        } else {
            dailyTotals = [:]
        }

        dailyTotalsDate =
            defaults.object(forKey: Self.dailyTotalsDateKey) as? Date
            ?? Date()
        resetDailyTotalsIfNeeded(now: Date())
        seedDiscoveredApplications()
        companionTransport.onCommand = { [weak self] command in
            self?.handleCompanionCommand(command)
        }
        companionTransport.start()
    }

    var currentAppLabel: String {
        currentApplication?.systemDisplayName ?? "没有可用的前台 App"
    }

    var currentAppIsMonitored: Bool {
        guard let bundleIdentifier = currentApplication?.bundleIdentifier else {
            return false
        }

        return monitoredApplications.contains {
            $0.bundleIdentifier == bundleIdentifier
        }
    }

    var monitoredAppCount: Int {
        monitoredApplications.count
    }

    var isAgentConnected: Bool {
        validAgentBaseURL != nil
    }

    var canSendCurrentCheckpoint: Bool {
        guard
            isMonitoring,
            currentAppIsMonitored,
            !currentApplicationIsWebsiteMonitoredBrowser,
            currentMonitoredApplication?.trimmedUserProvidedName.isEmpty
                == false,
            validAgentBaseURL != nil,
            lastCompletedRestDate != nil,
            !isSendingAgentRequest
        else {
            return false
        }

        return true
    }

    var currentApplicationIsWebsiteMonitoredBrowser: Bool {
        guard let bundleIdentifier = activeBundleIdentifier else {
            return false
        }
        return Self.websiteMonitoredBrowserBundleIdentifiers.contains(
            bundleIdentifier
        )
    }

    var lastCompletedRestDisplay: String {
        guard let lastCompletedRestDate else {
            return "尚未记录"
        }

        return lastCompletedRestDate.formatted(
            date: .abbreviated,
            time: .shortened
        )
    }

    var availableApplications: [ApplicationIdentity] {
        discoveredApplications.filter { application in
            !monitoredApplications.contains {
                $0.bundleIdentifier == application.bundleIdentifier
            }
        }
    }

    var currentContinuousMinutes: Int {
        Int(continuousSeconds / 60)
    }

    var currentDailyMinutes: Int {
        Int(currentDailySeconds / 60)
    }

    var currentContinuousDisplay: String {
        Self.durationDisplay(continuousSeconds)
    }

    var currentDailyDisplay: String {
        Self.durationDisplay(currentDailySeconds)
    }

    func startMonitoring() {
        guard !isMonitoring else {
            return
        }

        resetDailyTotalsIfNeeded(now: Date())
        seedDiscoveredApplications()
        installObservers()
        isMonitoring = true
        isCompanionResting = false
        let now = Date()
        screenContinuousStartedAt = now
        activate(workspace.frontmostApplication, at: now)
        startTimer()
    }

    func stopMonitoring() {
        guard isMonitoring else {
            return
        }

        commitActiveSession(at: Date(), preserveContinuity: false)
        removeObservers()
        timer?.invalidate()
        timer = nil
        continuityStates = [:]
        lastCheckpointNumber = [:]
        isMonitoring = false
        isCompanionResting = false
        activeBundleIdentifier = nil
        activeStartedAt = nil
        activeContinuousBase = 0
        continuousSeconds = 0
        screenContinuousStartedAt = nil
        continuousScreenSeconds = 0
        currentDailySeconds = 0
    }

    func addMonitoredApplication(_ application: ApplicationIdentity) {
        guard
            !monitoredApplications.contains(
                where: {
                    $0.bundleIdentifier == application.bundleIdentifier
                }
            )
        else {
            return
        }

        monitoredApplications.append(
            MonitoredApplication(
                bundleIdentifier: application.bundleIdentifier,
                systemDisplayName: application.systemDisplayName,
                bundleURL: application.bundleURL,
                userProvidedName: ""
            )
        )
        monitoredApplications.sort {
            $0.systemDisplayName.localizedCaseInsensitiveCompare(
                $1.systemDisplayName
            ) == .orderedAscending
        }
        persistMonitoredApplications()
        refreshPublishedDurations(now: Date())
    }

    func removeMonitoredApplication(bundleIdentifier: String) {
        monitoredApplications.removeAll {
            $0.bundleIdentifier == bundleIdentifier
        }
        persistMonitoredApplications()
        refreshPublishedDurations(now: Date())
    }

    func userProvidedName(for bundleIdentifier: String) -> String {
        monitoredApplications.first {
            $0.bundleIdentifier == bundleIdentifier
        }?.userProvidedName ?? ""
    }

    func updateUserProvidedName(
        _ name: String,
        for bundleIdentifier: String
    ) {
        guard
            let index = monitoredApplications.firstIndex(
                where: {
                    $0.bundleIdentifier == bundleIdentifier
                }
            )
        else {
            return
        }

        monitoredApplications[index].userProvidedName = name
        persistMonitoredApplications()
    }

    func recordRestCompleted() {
        let now = Date()
        lastCompletedRestDate = now
        isCompanionResting = false
        screenContinuousStartedAt = isMonitoring ? now : nil
        continuousScreenSeconds = 0
        defaults.set(now, forKey: Self.lastCompletedRestDateKey)
        agentStatusMessage = "已记录休息；下一检查点可以上传。"
    }

    func sendCurrentCheckpoint() {
        sendAgentCheckpoint(now: Date(), automatic: false)
    }

    func agentTestDecisionContext(now: Date) -> HushAgentDecisionContext {
        pruneSwitchHistory(now: now)
        let application = currentMonitoredApplication
        return HushAgentDecisionContext(
            measuredAt: ISO8601DateFormatter().string(from: now),
            platform: "macos",
            userProvidedContextLabel:
                application?.trimmedUserProvidedName,
            dailyAppUsageMinutes:
                application == nil ? nil : currentDailyMinutes,
            continuousAppUsageMinutes:
                application == nil ? nil : currentContinuousMinutes,
            continuousUsageIsEstimated:
                application == nil ? nil : false,
            appSwitchesLast10Minutes:
                application == nil ? nil : switchDates.count,
            minutesSinceLastRest: lastCompletedRestDate.map {
                max(0, Int(now.timeIntervalSince($0) / 60))
            },
            localHour: Calendar.current.component(.hour, from: now),
            rawAppNamesIncluded: false,
            fullURLIncluded: false,
            pageTitleIncluded: false,
            learningEligible: false
        )
    }

    func icon(for application: ApplicationIdentity) -> NSImage {
        icon(bundleURL: application.bundleURL)
    }

    func icon(for application: MonitoredApplication) -> NSImage {
        icon(bundleURL: application.bundleURL)
    }

    private func icon(bundleURL: URL?) -> NSImage {
        guard let bundleURL else {
            return NSImage(
                systemSymbolName: "app",
                accessibilityDescription: nil
            ) ?? NSImage()
        }

        return workspace.icon(forFile: bundleURL.path)
    }

    private func seedDiscoveredApplications() {
        for application in workspace.runningApplications
        where application.activationPolicy == .regular {
            registerDiscoveredApplication(application)
        }
    }

    private func registerDiscoveredApplication(
        _ application: NSRunningApplication
    ) {
        guard
            let bundleIdentifier = application.bundleIdentifier,
            bundleIdentifier != Bundle.main.bundleIdentifier,
            let displayName = application.localizedName,
            !displayName.isEmpty
        else {
            return
        }

        let identity = ApplicationIdentity(
            bundleIdentifier: bundleIdentifier,
            systemDisplayName: displayName,
            bundleURL: application.bundleURL
        )

        if
            let index = discoveredApplications.firstIndex(
                where: {
                    $0.bundleIdentifier == bundleIdentifier
                }
            )
        {
            discoveredApplications[index] = identity
        } else {
            discoveredApplications.append(identity)
        }

        discoveredApplications.sort {
            $0.systemDisplayName.localizedCaseInsensitiveCompare(
                $1.systemDisplayName
            ) == .orderedAscending
        }
    }

    private func installObservers() {
        guard observers.isEmpty else {
            return
        }

        let center = workspace.notificationCenter

        observers.append(
            center.addObserver(
                forName: NSWorkspace.didActivateApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                guard
                    let application = notification.userInfo?[
                        NSWorkspace.applicationUserInfoKey
                    ] as? NSRunningApplication
                else {
                    return
                }

                Task { @MainActor [weak self] in
                    self?.activate(application, at: Date())
                }
            }
        )

        for notificationName in [
            NSWorkspace.sessionDidResignActiveNotification,
            NSWorkspace.willSleepNotification
        ] {
            observers.append(
                center.addObserver(
                    forName: notificationName,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    Task { @MainActor [weak self] in
                        self?.pauseForInactiveSession(at: Date())
                    }
                }
            )
        }

        for notificationName in [
            NSWorkspace.sessionDidBecomeActiveNotification,
            NSWorkspace.didWakeNotification
        ] {
            observers.append(
                center.addObserver(
                    forName: notificationName,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    Task { @MainActor [weak self] in
                        guard let self else {
                            return
                        }

                        self.activate(
                            self.workspace.frontmostApplication,
                            at: Date()
                        )
                    }
                }
            )
        }
    }

    private func removeObservers() {
        let center = workspace.notificationCenter
        observers.forEach(center.removeObserver)
        observers.removeAll()
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(
            withTimeInterval: 1,
            repeats: true
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else {
                    return
                }

                let now = Date()
                self.refreshPublishedDurations(now: now)
                self.sendAutomaticCheckpointIfNeeded(now: now)
                self.publishCompanionSnapshot(now: now)
            }
        }
    }

    private func publishCompanionSnapshot(now: Date) {
        companionSequence += 1
        companionTransport.send(
            snapshot: HushCompanionSnapshot(
                protocolVersion: HushCompanionSnapshot.protocolVersion,
                sessionID: companionSessionID,
                sequence: companionSequence,
                emittedAt: now,
                deviceName:
                    Host.current().localizedName ?? "Hush Mac",
                currentContext:
                    currentMonitoredApplication?.trimmedUserProvidedName
                    ?? "等待已关注的工作",
                continuousScreenSeconds:
                    max(0, Int(continuousScreenSeconds)),
                continuousAppSeconds: max(0, Int(continuousSeconds)),
                dailySeconds: max(0, Int(currentDailySeconds)),
                isMonitoring: isMonitoring && currentAppIsMonitored,
                interruptionMode: interruptionMode.rawValue,
                latestDecision: latestCompanionDecision
            )
        )
    }

    private func handleCompanionCommand(
        _ command: HushCompanionCommand
    ) {
        switch command.kind {
        case .restCompleted:
            recordRestCompleted()
            latestCompanionDecision = nil
        case .restStarted:
            isCompanionResting = true
            screenContinuousStartedAt = nil
            continuousScreenSeconds = 0
            if command.decisionID == latestCompanionDecision?.id {
                latestCompanionDecision = nil
            }
        case .remindLater, .suggestionDismissed:
            if command.decisionID == latestCompanionDecision?.id {
                latestCompanionDecision = nil
            }
        }
    }

    private func activate(
        _ application: NSRunningApplication?,
        at now: Date
    ) {
        if
            isMonitoring,
            !isCompanionResting,
            screenContinuousStartedAt == nil
        {
            screenContinuousStartedAt = now
        }
        let previousBundleIdentifier = activeBundleIdentifier
        commitActiveSession(at: now)
        continuityStates = continuityStates.filter {
            now.timeIntervalSince($0.value.leftAt)
                < Self.continuityGraceInterval
        }

        guard
            let application,
            let bundleIdentifier = application.bundleIdentifier,
            bundleIdentifier != Bundle.main.bundleIdentifier
        else {
            currentApplication = nil
            activeBundleIdentifier = nil
            activeStartedAt = nil
            activeContinuousBase = 0
            refreshPublishedDurations(now: now)
            return
        }

        registerDiscoveredApplication(application)
        currentApplication = ApplicationIdentity(
            bundleIdentifier: bundleIdentifier,
            systemDisplayName:
                application.localizedName ?? "未命名 App",
            bundleURL: application.bundleURL
        )
        activeBundleIdentifier = bundleIdentifier
        if
            let previousBundleIdentifier,
            previousBundleIdentifier != bundleIdentifier
        {
            switchDates.append(now)
            pruneSwitchHistory(now: now)
        }
        activeStartedAt = now
        if
            let continuityState = continuityStates[bundleIdentifier],
            now.timeIntervalSince(continuityState.leftAt)
                < Self.continuityGraceInterval
        {
            activeContinuousBase =
                continuityState.accumulatedSeconds
        } else {
            activeContinuousBase = 0
            lastCheckpointNumber[bundleIdentifier] = 0
        }
        continuityStates.removeValue(forKey: bundleIdentifier)
        refreshPublishedDurations(now: now)
    }

    private var currentMonitoredApplication: MonitoredApplication? {
        guard let bundleIdentifier = activeBundleIdentifier else {
            return nil
        }

        return monitoredApplications.first {
            $0.bundleIdentifier == bundleIdentifier
        }
    }

    private var validAgentBaseURL: URL? {
        let trimmed = agentBaseURL.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard
            let url = URL(string: trimmed),
            url.scheme?.lowercased() == "https",
            url.host != nil
        else {
            return nil
        }

        return url
    }

    private func sendAutomaticCheckpointIfNeeded(now: Date) {
        guard
            !isCompanionResting,
            let bundleIdentifier = activeBundleIdentifier,
            currentMonitoredApplication != nil,
            !Self.websiteMonitoredBrowserBundleIdentifiers.contains(
                bundleIdentifier
            )
        else {
            return
        }

        let checkpointNumber = Int(
            continuousSeconds / Self.checkpointInterval
        )
        guard
            checkpointNumber > 0,
            checkpointNumber
                > lastCheckpointNumber[bundleIdentifier, default: 0]
        else {
            return
        }

        lastCheckpointNumber[bundleIdentifier] = checkpointNumber
        sendAgentCheckpoint(now: now, automatic: true)
    }

    private func sendAgentCheckpoint(now: Date, automatic: Bool) {
        guard !isSendingAgentRequest else {
            return
        }
        guard let application = currentMonitoredApplication else {
            agentStatusMessage = "当前 App 不在关注范围内。"
            return
        }

        let contextLabel = application.trimmedUserProvidedName
        guard !contextLabel.isEmpty else {
            agentStatusMessage = "请先填写当前 App 发给 Agent 的名称。"
            return
        }
        guard let baseURL = validAgentBaseURL else {
            agentStatusMessage = "请填写有效的 HTTPS Agent 地址。"
            return
        }
        guard let lastCompletedRestDate else {
            agentStatusMessage = "请先记录一次休息，再发送真实数据。"
            return
        }

        pruneSwitchHistory(now: now)
        let requestID = "req_mac_\(UUID().uuidString.lowercased())"
        let payload = UsageSummaryRequest(
            requestID: requestID,
            measuredAt: ISO8601DateFormatter().string(from: now),
            userProvidedContextLabel: contextLabel,
            dailyAppUsageMinutes: currentDailyMinutes,
            continuousAppUsageMinutes: currentContinuousMinutes,
            continuousScreenUsageMinutes:
                Int(continuousScreenSeconds / 60),
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
            agentStatusMessage = "无法生成请求数据。"
            return
        }

        lastRequestJSON = String(data: body, encoding: .utf8)
        agentStatusMessage = automatic
            ? "已到 5 分钟检查点，正在请求 Agent…"
            : "正在发送测试检查点…"
        isSendingAgentRequest = true

        let endpoint = baseURL
            .appendingPathComponent("v1")
            .appendingPathComponent("rest")
            .appendingPathComponent("evaluate")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 35
        request.httpBody = body
        request.setValue(
            "application/json",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue(requestID, forHTTPHeaderField: "X-Request-ID")
        request.setValue("1.0.0", forHTTPHeaderField: "X-Client-Version")
        request.setValue("1.1", forHTTPHeaderField: "X-Contract-Version")

        Task {
            do {
                let (data, response) = try await URLSession.shared.data(
                    for: request
                )
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw URLError(.badServerResponse)
                }
                guard (200..<300).contains(httpResponse.statusCode) else {
                    agentStatusMessage =
                        "Agent 返回 HTTP \(httpResponse.statusCode)。"
                    isSendingAgentRequest = false
                    return
                }

                let suggestion = try JSONDecoder().decode(
                    RestSuggestionResponse.self,
                    from: data
                )
                guard
                    suggestion.requestID == requestID,
                    suggestion.shouldOfferRest
                        == (suggestion.generatedTask != nil),
                    suggestion.defaultQuestID == nil
                else {
                    agentStatusMessage = "Agent 响应的 request_id 不匹配。"
                    isSendingAgentRequest = false
                    return
                }

                latestCompanionDecision = HushCompanionDecision(
                    id: suggestion.requestID,
                    decidedAt: Date(),
                    shouldOfferRest: suggestion.shouldOfferRest,
                    reasonCode: suggestion.reasonCode,
                    message: suggestion.message,
                    defaultQuestID: suggestion.defaultQuestID,
                    generatedTask: suggestion.generatedTask
                )
                agentStatusMessage = suggestion.shouldOfferRest
                    ? "Agent 建议休息：\(suggestion.message)"
                    : "Agent 建议继续：\(suggestion.message)"
                if suggestion.shouldOfferRest,
                   let generatedTask = suggestion.generatedTask
                {
                    HushMacRestNotificationController.shared
                        .sendRestSuggestion(
                            message: suggestion.message,
                            generatedTask: generatedTask,
                            requestID: suggestion.requestID
                        )
                }
            } catch {
                agentStatusMessage =
                    "Agent 请求失败：\(error.localizedDescription)"
            }
            isSendingAgentRequest = false
        }
    }

    private func pruneSwitchHistory(now: Date) {
        switchDates.removeAll {
            now.timeIntervalSince($0) > Self.switchHistoryInterval
        }
    }

    private func pauseForInactiveSession(at now: Date) {
        commitActiveSession(at: now, preserveContinuity: false)
        continuityStates = [:]
        currentApplication = nil
        activeBundleIdentifier = nil
        activeStartedAt = nil
        activeContinuousBase = 0
        screenContinuousStartedAt = nil
        continuousScreenSeconds = 0
        refreshPublishedDurations(now: now)
    }

    private func commitActiveSession(
        at now: Date,
        preserveContinuity: Bool = true
    ) {
        resetDailyTotalsIfNeeded(now: now)
        guard
            let bundleIdentifier = activeBundleIdentifier,
            let activeStartedAt
        else {
            return
        }

        let elapsed = max(0, now.timeIntervalSince(activeStartedAt))
        dailyTotals[bundleIdentifier, default: 0] += elapsed
        if preserveContinuity {
            continuityStates[bundleIdentifier] = ContinuityState(
                accumulatedSeconds: activeContinuousBase + elapsed,
                leftAt: now
            )
        } else {
            continuityStates.removeValue(forKey: bundleIdentifier)
        }
        persistDailyTotals()
    }

    private func refreshPublishedDurations(now: Date) {
        resetDailyTotalsIfNeeded(now: now)
        if let screenContinuousStartedAt, isMonitoring {
            continuousScreenSeconds = max(
                0,
                now.timeIntervalSince(screenContinuousStartedAt)
            )
        } else {
            continuousScreenSeconds = 0
        }
        guard
            let bundleIdentifier = activeBundleIdentifier,
            let activeStartedAt
        else {
            continuousSeconds = 0
            currentDailySeconds = 0
            return
        }

        let activeElapsed = max(
            0,
            now.timeIntervalSince(activeStartedAt)
        )
        continuousSeconds = activeContinuousBase + activeElapsed
        currentDailySeconds =
            dailyTotals[bundleIdentifier, default: 0] + activeElapsed
    }

    private func resetDailyTotalsIfNeeded(now: Date) {
        guard !Calendar.current.isDate(dailyTotalsDate, inSameDayAs: now)
        else {
            return
        }

        dailyTotals = [:]
        dailyTotalsDate = now
        if let activeStartedAt {
            activeContinuousBase += max(
                0,
                now.timeIntervalSince(activeStartedAt)
            )
            self.activeStartedAt = now
        }
        defaults.set(now, forKey: Self.dailyTotalsDateKey)
        persistDailyTotals()
    }

    private func persistMonitoredApplications() {
        guard
            let data = try? PropertyListEncoder().encode(
                monitoredApplications
            )
        else {
            return
        }

        defaults.set(data, forKey: Self.monitoredApplicationsKey)
    }

    private func persistDailyTotals() {
        guard
            let data = try? PropertyListEncoder().encode(dailyTotals)
        else {
            return
        }

        defaults.set(data, forKey: Self.dailyTotalsKey)
        defaults.set(dailyTotalsDate, forKey: Self.dailyTotalsDateKey)
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

private extension MacUsageMonitoringModel.MonitoredApplication {
    var trimmedUserProvidedName: String {
        userProvidedName.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
