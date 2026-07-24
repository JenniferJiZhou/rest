import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
import UserNotifications

final class HushDeviceActivityMonitor: DeviceActivityMonitor {
    private struct AppUsageState: Codable {
        let lastThresholdDate: Date
        let lastDailyCheckpointMinutes: Int
        let estimatedContinuousMinutes: Int
    }

    private static let appGroupIdentifier = "group.com.JenniferJi.Hush"
    private static let interruptionModeKey = "deviceActivity.interruptionMode"
    private static let agentBaseURLKey = "agent.baseURL"
    private static let eventContextLabelsKey =
        "deviceActivity.eventContextLabels"
    private static let eventApplicationTokensKey =
        "deviceActivity.eventApplicationTokens"
    private static let lastCompletedRestDateKey = "restSession.lastCompletedDate"
    private static let lastThresholdKey = "deviceActivity.lastThresholdDate"
    private static let lastAgentDecisionKey = "agent.lastDecisionMessage"
    private static let lastAgentErrorKey = "agent.lastErrorMessage"
    private static let appUsageStatesKey = "deviceActivity.appUsageStates"
    private static let continuousUsageGraceInterval: TimeInterval = 7 * 60
    private static let managedSettingsStore = ManagedSettingsStore(
        named: ManagedSettingsStore.Name("hush.interruption")
    )

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        Self.managedSettingsStore.clearAllSettings()
        HushLockdownState.clear()
        UserDefaults(suiteName: Self.appGroupIdentifier)?
            .removeObject(forKey: Self.appUsageStatesKey)
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        Self.managedSettingsStore.clearAllSettings()
        HushLockdownState.clear()
    }

    override func eventDidReachThreshold(
        _ event: DeviceActivityEvent.Name,
        activity: DeviceActivityName
    ) {
        super.eventDidReachThreshold(event, activity: activity)

        guard let checkpointMinutes = Self.checkpointMinutes(from: event) else {
            return
        }

        let now = Date()
        let userDefaults = UserDefaults(suiteName: Self.appGroupIdentifier)
        userDefaults?.set(now, forKey: Self.lastThresholdKey)

        guard
            let contextID = Self.contextID(from: event),
            let contextLabel = Self.contextLabel(
                for: event,
                userDefaults: userDefaults
            ),
            let applicationToken = Self.applicationToken(
                for: event,
                userDefaults: userDefaults
            )
        else {
            recordAgentError(
                "没有找到触发 App 对应的用户名称。",
                userDefaults: userDefaults
            )
            return
        }

        let usageState = Self.recordUsageCheckpoint(
            contextID: contextID,
            dailyCheckpointMinutes: checkpointMinutes,
            now: now,
            userDefaults: userDefaults
        )

        requestAgentDecision(
            dailyAppUsageMinutes: checkpointMinutes,
            estimatedContinuousAppUsageMinutes:
                usageState.estimatedContinuousMinutes,
            contextLabel: contextLabel,
            applicationToken: applicationToken,
            now: now,
            userDefaults: userDefaults
        )
    }

    private func requestAgentDecision(
        dailyAppUsageMinutes: Int,
        estimatedContinuousAppUsageMinutes: Int,
        contextLabel: String,
        applicationToken: ApplicationToken,
        now: Date,
        userDefaults: UserDefaults?
    ) {
        guard
            let baseURL = userDefaults?.string(forKey: Self.agentBaseURLKey),
            !baseURL.isEmpty
        else {
            recordAgentError("云端 Agent 尚未配置。", userDefaults: userDefaults)
            return
        }

        let minutesSinceLastRest = Self.minutesSinceLastRest(
            now: now,
            userDefaults: userDefaults
        )

        Task {
            do {
                let provider = try HTTPRestDecisionProvider(
                    baseURLString: baseURL
                )
                let decision = try await provider.evaluate(
                    dailyAppUsageMinutes: dailyAppUsageMinutes,
                    estimatedContinuousAppUsageMinutes:
                        estimatedContinuousAppUsageMinutes,
                    contextLabel: contextLabel,
                    minutesSinceLastRest: minutesSinceLastRest
                )
                userDefaults?.removeObject(forKey: Self.lastAgentErrorKey)
                userDefaults?.set(
                    decision.message,
                    forKey: Self.lastAgentDecisionKey
                )

                guard decision.shouldOfferRest else {
                    return
                }

                if userDefaults?.string(
                    forKey: Self.interruptionModeKey
                ) == "firm" {
                    applyFirmInterruption(
                        applicationToken: applicationToken,
                        contextLabel: contextLabel,
                        message: decision.message
                    )
                }

                scheduleReminder(
                    contextLabel: contextLabel,
                    agentMessage: decision.message
                )
            } catch {
                recordAgentError(
                    "无法连接云端 Agent，本次未执行打断。",
                    userDefaults: userDefaults
                )
            }
        }
    }

    private static func checkpointMinutes(
        from event: DeviceActivityEvent.Name
    ) -> Int? {
        guard let value = event.rawValue.split(separator: ".").last else {
            return nil
        }

        return Int(value)
    }

    private static func contextID(
        from event: DeviceActivityEvent.Name
    ) -> String? {
        let prefix = "hush.app."
        let checkpointMarker = ".checkpoint."
        guard
            event.rawValue.hasPrefix(prefix),
            let checkpointRange = event.rawValue.range(
                of: checkpointMarker
            )
        else {
            return nil
        }

        let contextStart = event.rawValue.index(
            event.rawValue.startIndex,
            offsetBy: prefix.count
        )
        return String(event.rawValue[contextStart..<checkpointRange.lowerBound])
    }

    private static func recordUsageCheckpoint(
        contextID: String,
        dailyCheckpointMinutes: Int,
        now: Date,
        userDefaults: UserDefaults?
    ) -> AppUsageState {
        var states = loadUsageStates(userDefaults: userDefaults)
        let previousState = states[contextID]
        let isNextCheckpoint =
            previousState.map {
                dailyCheckpointMinutes
                    - $0.lastDailyCheckpointMinutes == 5
            } ?? false
        let isWithinContinuousWindow =
            previousState.map {
                now.timeIntervalSince($0.lastThresholdDate)
                    <= Self.continuousUsageGraceInterval
            } ?? false
        let estimatedContinuousMinutes =
            isNextCheckpoint && isWithinContinuousWindow
            ? (previousState?.estimatedContinuousMinutes ?? 0) + 5
            : 5
        let state = AppUsageState(
            lastThresholdDate: now,
            lastDailyCheckpointMinutes: dailyCheckpointMinutes,
            estimatedContinuousMinutes: estimatedContinuousMinutes
        )
        states[contextID] = state

        if let data = try? PropertyListEncoder().encode(states) {
            userDefaults?.set(data, forKey: Self.appUsageStatesKey)
        }

        return state
    }

    private static func loadUsageStates(
        userDefaults: UserDefaults?
    ) -> [String: AppUsageState] {
        guard
            let data = userDefaults?.data(forKey: Self.appUsageStatesKey),
            let states = try? PropertyListDecoder().decode(
                [String: AppUsageState].self,
                from: data
            )
        else {
            return [:]
        }

        return states
    }

    private static func contextLabel(
        for event: DeviceActivityEvent.Name,
        userDefaults: UserDefaults?
    ) -> String? {
        guard
            let labels = userDefaults?.dictionary(
                forKey: Self.eventContextLabelsKey
            ) as? [String: String],
            let label = labels[event.rawValue],
            !label.isEmpty
        else {
            return nil
        }

        return label
    }

    private static func applicationToken(
        for event: DeviceActivityEvent.Name,
        userDefaults: UserDefaults?
    ) -> ApplicationToken? {
        guard
            let tokenDataByEvent = userDefaults?.dictionary(
                forKey: Self.eventApplicationTokensKey
            ) as? [String: Data],
            let tokenData = tokenDataByEvent[event.rawValue]
        else {
            return nil
        }

        return try? PropertyListDecoder().decode(
            ApplicationToken.self,
            from: tokenData
        )
    }

    private static func minutesSinceLastRest(
        now: Date,
        userDefaults: UserDefaults?
    ) -> Int {
        guard
            let lastRestDate = userDefaults?.object(
                forKey: Self.lastCompletedRestDateKey
            ) as? Date
        else {
            return 180
        }

        return max(
            0,
            Int(now.timeIntervalSince(lastRestDate) / 60)
        )
    }

    private func applyFirmInterruption(
        applicationToken: ApplicationToken,
        contextLabel: String,
        message: String
    ) {
        let store = Self.managedSettingsStore
        store.clearAllSettings()
        store.shield.applications = [applicationToken]
        HushLockdownState(
            id: UUID(),
            userProvidedContextLabel: contextLabel,
            message: message,
            activatedAt: Date()
        )
        .persist()
    }

    private func scheduleReminder(
        contextLabel: String,
        agentMessage: String
    ) {
        let content = UNMutableNotificationContent()
        content.title = "Hush"
        content.body = agentMessage.isEmpty
            ? "已经使用了一会儿 \(contextLabel)。现在把一分钟留给自己吧。"
            : agentMessage
        content.sound = .default
        content.userInfo = ["hush_entry": "device_activity"]

        let request = UNNotificationRequest(
            identifier: "hush.device-activity.\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request)
    }

    private func recordAgentError(
        _ message: String,
        userDefaults: UserDefaults?
    ) {
        userDefaults?.set(message, forKey: Self.lastAgentErrorKey)
    }
}
