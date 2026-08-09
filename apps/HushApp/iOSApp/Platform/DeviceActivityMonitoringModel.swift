import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

@MainActor
final class DeviceActivityMonitoringModel: ObservableObject {
    private struct AppUsageState: Codable {
        let lastThresholdDate: Date
        let lastDailyCheckpointMinutes: Int
        let estimatedContinuousMinutes: Int
    }

    @Published private(set) var isMonitoring = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var lastThresholdDate: Date?

    private static let appGroupIdentifier = "group.com.JenniferJi.Hush"
    private static let activityName = DeviceActivityName("hush.daily-monitor")
    private static let checkpointMinutes = Array(stride(from: 5, through: 60, by: 5))
    private static let lastThresholdKey = "deviceActivity.lastThresholdDate"
    private static let eventContextLabelsKey = "deviceActivity.eventContextLabels"
    private static let eventApplicationTokensKey = "deviceActivity.eventApplicationTokens"
    private static let appUsageStatesKey = "deviceActivity.appUsageStates"
    private static let lastCompletedRestDateKey = "restSession.lastCompletedDate"
    private static let managedSettingsStore = ManagedSettingsStore(
        named: ManagedSettingsStore.Name("hush.interruption")
    )

    private let center = DeviceActivityCenter()
    private let userDefaults: UserDefaults?

    init(userDefaults: UserDefaults? = nil) {
        self.userDefaults = userDefaults
            ?? UserDefaults(suiteName: Self.appGroupIdentifier)
        refreshStatus()
    }

    var monitoringStatusMessage: String {
        isMonitoring ? "每 5 分钟云端检查已启用" : "尚未启动设备活动监测"
    }

    var lastThresholdMessage: String {
        guard let lastThresholdDate else {
            return "尚未收到阈值事件"
        }

        return "最近一次阈值事件：\(lastThresholdDate.formatted(date: .abbreviated, time: .shortened))"
    }

    func refreshStatus() {
        isMonitoring = center.activities.contains(Self.activityName)
        lastThresholdDate = userDefaults?.object(forKey: Self.lastThresholdKey) as? Date
    }

    func startMonitoring(
        applicationContexts: [FamilyActivitySelectionStore.ApplicationContext]
    ) {
        guard !applicationContexts.isEmpty else {
            errorMessage = "请先选择至少一个具体 App。"
            return
        }

        guard applicationContexts.allSatisfy({
            !$0.userProvidedName.isEmpty
        }) else {
            errorMessage = "请先为每个 App 填写名称。"
            return
        }

        let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59),
            repeats: true
        )

        var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
        var contextLabelsByEvent: [String: String] = [:]
        var applicationTokensByEvent: [String: Data] = [:]

        for context in applicationContexts {
            guard
                let tokenData = try? PropertyListEncoder().encode(context.token)
            else {
                continue
            }

            for minutes in Self.checkpointMinutes {
                let eventName = Self.eventName(
                    contextID: context.id,
                    minutes: minutes
                )
                let event: DeviceActivityEvent

                if #available(iOS 17.4, *) {
                    event = DeviceActivityEvent(
                        applications: [context.token],
                        threshold: DateComponents(minute: minutes),
                        includesPastActivity: false
                    )
                } else {
                    event = DeviceActivityEvent(
                        applications: [context.token],
                        threshold: DateComponents(minute: minutes)
                    )
                }

                events[eventName] = event
                contextLabelsByEvent[eventName.rawValue] =
                    context.userProvidedName
                applicationTokensByEvent[eventName.rawValue] = tokenData
            }
        }

        do {
            center.stopMonitoring([Self.activityName])
            Self.managedSettingsStore.clearAllSettings()
            HushLockdownState.clear()
            userDefaults?.removeObject(forKey: Self.appUsageStatesKey)
            userDefaults?.set(
                contextLabelsByEvent,
                forKey: Self.eventContextLabelsKey
            )
            userDefaults?.set(
                applicationTokensByEvent,
                forKey: Self.eventApplicationTokensKey
            )
            try center.startMonitoring(
                Self.activityName,
                during: schedule,
                events: events
            )
            errorMessage = nil
            refreshStatus()
        } catch {
            errorMessage = "无法启动设备活动监测，请检查屏幕使用时间权限后重试。"
            refreshStatus()
        }
    }

    func stopMonitoring() {
        center.stopMonitoring([Self.activityName])
        Self.managedSettingsStore.clearAllSettings()
        HushLockdownState.clear()
        userDefaults?.removeObject(forKey: Self.eventContextLabelsKey)
        userDefaults?.removeObject(forKey: Self.eventApplicationTokensKey)
        userDefaults?.removeObject(forKey: Self.appUsageStatesKey)
        errorMessage = nil
        refreshStatus()
    }

    func agentTestDecisionContext(
        applicationContexts: [
            FamilyActivitySelectionStore.ApplicationContext
        ],
        now: Date
    ) -> HushAgentDecisionContext {
        agentTestDecisionContext(
            configuredContextLabels: Dictionary(
                uniqueKeysWithValues: applicationContexts.map {
                    ($0.id, $0.userProvidedName)
                }
            ),
            now: now
        )
    }

    func agentTestDecisionContext(
        configuredContextLabels: [UUID: String],
        now: Date
    ) -> HushAgentDecisionContext {
        let states: [String: AppUsageState]
        if
            let data = userDefaults?.data(forKey: Self.appUsageStatesKey),
            let decoded = try? PropertyListDecoder().decode(
                [String: AppUsageState].self,
                from: data
            )
        {
            states = decoded
        } else {
            states = [:]
        }

        let latest = configuredContextLabels.compactMap { id, label in
            states[id.uuidString].map { (state: $0, label: label) }
        }
        .max { $0.state.lastThresholdDate < $1.state.lastThresholdDate }
        let calendar = Calendar.current

        guard let latest else {
            return HushAgentDecisionContext(
                measuredAt: ISO8601DateFormatter().string(from: now),
                platform: "ios",
                userProvidedContextLabel: nil,
                dailyAppUsageMinutes: nil,
                continuousAppUsageMinutes: nil,
                continuousUsageIsEstimated: nil,
                appSwitchesLast10Minutes: nil,
                minutesSinceLastRest: nil,
                localHour: calendar.component(.hour, from: now),
                rawAppNamesIncluded: false,
                fullURLIncluded: false,
                pageTitleIncluded: false,
                learningEligible: false
            )
        }

        let lastRestDate = userDefaults?.object(
            forKey: Self.lastCompletedRestDateKey
        ) as? Date
        return HushAgentDecisionContext(
            measuredAt: ISO8601DateFormatter().string(
                from: latest.state.lastThresholdDate
            ),
            platform: "ios",
            userProvidedContextLabel: latest.label,
            dailyAppUsageMinutes:
                latest.state.lastDailyCheckpointMinutes,
            continuousAppUsageMinutes:
                latest.state.estimatedContinuousMinutes,
            continuousUsageIsEstimated: true,
            appSwitchesLast10Minutes: nil,
            minutesSinceLastRest: lastRestDate.map {
                max(0, Int(now.timeIntervalSince($0) / 60))
            },
            localHour: calendar.component(.hour, from: now),
            rawAppNamesIncluded: false,
            fullURLIncluded: false,
            pageTitleIncluded: false,
            learningEligible: false
        )
    }

    private static func eventName(
        contextID: UUID,
        minutes: Int
    ) -> DeviceActivityEvent.Name {
        DeviceActivityEvent.Name(
            "hush.app.\(contextID.uuidString).checkpoint.\(minutes)"
        )
    }
}
