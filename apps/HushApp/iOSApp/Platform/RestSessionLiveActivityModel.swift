import ActivityKit
import Foundation
import ManagedSettings
import SwiftUI

@MainActor
final class RestSessionLiveActivityModel: ObservableObject {
    enum Phase: Equatable {
        case idle
        case running
        case paused
        case completed
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var remainingSeconds = 60
    @Published private(set) var isLiveActivityActive = false
    @Published private(set) var errorMessage: String?

    let sessionName = "1 分钟安静休息"
    let durationSeconds = 60

    private enum StorageKey {
        static let phase = "hush.rest-session.phase"
        static let expectedEndDate = "hush.rest-session.expected-end-date"
        static let remainingSeconds = "hush.rest-session.remaining-seconds"
    }

    private static let managedSettingsStore = ManagedSettingsStore(
        named: ManagedSettingsStore.Name("hush.interruption")
    )
    private static let appGroupDefaults = UserDefaults(
        suiteName: "group.com.JenniferJi.Hush"
    )
    private static let lastCompletedRestDateKey = "restSession.lastCompletedDate"

    private let defaults: UserDefaults
    private var expectedEndDate: Date?
    private var tickerTask: Task<Void, Never>?
    private var hasRestored = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    deinit {
        tickerTask?.cancel()
    }

    var phaseMessage: String {
        switch phase {
        case .idle:
            return "在 App 内计时；支持时也会显示在锁屏和灵动岛。"
        case .running:
            return isLiveActivityActive ? "休息中 · 锁屏活动已开启" : "休息中 · App 内计时"
        case .paused:
            return "已暂停"
        case .completed:
            return "这一分钟已经留给自己了。"
        }
    }

    var formattedRemainingTime: String {
        let minutes = remainingSeconds / 60
        let seconds = remainingSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    func restoreIfNeeded() async {
        guard !hasRestored else {
            return
        }
        hasRestored = true

        isLiveActivityActive = !Activity<HushRestAttributes>.activities.isEmpty

        guard let storedPhase = defaults.string(forKey: StorageKey.phase) else {
            await removeOrphanedActivities()
            return
        }

        switch storedPhase {
        case "running":
            guard
                let endDate = defaults.object(forKey: StorageKey.expectedEndDate) as? Date,
                endDate > Date()
            else {
                await finishCompletedSession()
                return
            }

            phase = .running
            expectedEndDate = endDate
            updateRemainingTime()
            startTicker()
        case "paused":
            phase = .paused
            remainingSeconds = max(
                1,
                defaults.integer(forKey: StorageKey.remainingSeconds)
            )
        default:
            clearPersistedSession()
            await removeOrphanedActivities()
        }
    }

    func start() async {
        tickerTask?.cancel()
        errorMessage = nil
        phase = .running
        remainingSeconds = durationSeconds
        expectedEndDate = Date().addingTimeInterval(TimeInterval(durationSeconds))
        persistSession()
        startTicker()

        await endAllActivities(
            finalPhase: .ended,
            remainingSeconds: durationSeconds
        )

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            errorMessage = "系统当前未开放实时活动，App 内计时会继续。"
            return
        }

        guard let expectedEndDate else {
            return
        }

        let attributes = HushRestAttributes(sessionName: sessionName)
        let state = HushRestAttributes.ContentState(
            phase: .running,
            expectedEndDate: expectedEndDate,
            remainingSeconds: durationSeconds
        )

        do {
            _ = try Activity.request(
                attributes: attributes,
                content: ActivityContent(
                    state: state,
                    staleDate: expectedEndDate
                ),
                pushType: nil
            )
            isLiveActivityActive = true
        } catch {
            isLiveActivityActive = false
            errorMessage = "实时活动未能启动，App 内计时会继续。"
        }
    }

    func pause() async {
        guard phase == .running else {
            return
        }

        updateRemainingTime()
        tickerTask?.cancel()
        expectedEndDate = nil
        phase = .paused
        persistSession()

        await updateActivities(
            phase: .paused,
            expectedEndDate: nil,
            remainingSeconds: remainingSeconds
        )
    }

    func resume() async {
        guard phase == .paused else {
            return
        }

        expectedEndDate = Date().addingTimeInterval(TimeInterval(remainingSeconds))
        phase = .running
        persistSession()
        startTicker()

        await updateActivities(
            phase: .running,
            expectedEndDate: expectedEndDate,
            remainingSeconds: remainingSeconds
        )
    }

    func endEarly() async {
        guard phase == .running || phase == .paused else {
            return
        }

        tickerTask?.cancel()
        expectedEndDate = nil
        phase = .idle
        remainingSeconds = durationSeconds
        clearPersistedSession()
        Self.managedSettingsStore.clearAllSettings()
        HushLockdownState.clear()
        await endAllActivities(
            finalPhase: .ended,
            remainingSeconds: remainingSeconds
        )
    }

    func startAgain() async {
        await start()
    }

    private func startTicker() {
        tickerTask?.cancel()
        tickerTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else {
                    return
                }

                self.updateRemainingTime()
                if self.remainingSeconds == 0 {
                    await self.finishCompletedSession()
                    return
                }

                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func updateRemainingTime() {
        guard phase == .running, let expectedEndDate else {
            return
        }

        remainingSeconds = max(
            0,
            Int(ceil(expectedEndDate.timeIntervalSinceNow))
        )
    }

    private func finishCompletedSession() async {
        tickerTask?.cancel()
        expectedEndDate = nil
        remainingSeconds = 0
        phase = .completed
        clearPersistedSession()
        Self.appGroupDefaults?.set(
            Date(),
            forKey: Self.lastCompletedRestDateKey
        )
        Self.managedSettingsStore.clearAllSettings()
        HushLockdownState.clear()
        await endAllActivities(
            finalPhase: .completed,
            remainingSeconds: 0
        )
    }

    private func persistSession() {
        switch phase {
        case .running:
            defaults.set("running", forKey: StorageKey.phase)
            defaults.set(expectedEndDate, forKey: StorageKey.expectedEndDate)
            defaults.removeObject(forKey: StorageKey.remainingSeconds)
        case .paused:
            defaults.set("paused", forKey: StorageKey.phase)
            defaults.set(remainingSeconds, forKey: StorageKey.remainingSeconds)
            defaults.removeObject(forKey: StorageKey.expectedEndDate)
        case .idle, .completed:
            clearPersistedSession()
        }
    }

    private func clearPersistedSession() {
        defaults.removeObject(forKey: StorageKey.phase)
        defaults.removeObject(forKey: StorageKey.expectedEndDate)
        defaults.removeObject(forKey: StorageKey.remainingSeconds)
    }

    private func updateActivities(
        phase: HushRestAttributes.ContentState.Phase,
        expectedEndDate: Date?,
        remainingSeconds: Int
    ) async {
        let state = HushRestAttributes.ContentState(
            phase: phase,
            expectedEndDate: expectedEndDate,
            remainingSeconds: remainingSeconds
        )

        for activity in Activity<HushRestAttributes>.activities {
            await activity.update(
                ActivityContent(
                    state: state,
                    staleDate: expectedEndDate
                )
            )
        }

        isLiveActivityActive = !Activity<HushRestAttributes>.activities.isEmpty
    }

    private func endAllActivities(
        finalPhase: HushRestAttributes.ContentState.Phase,
        remainingSeconds: Int
    ) async {
        let state = HushRestAttributes.ContentState(
            phase: finalPhase,
            expectedEndDate: nil,
            remainingSeconds: remainingSeconds
        )
        let finalContent = ActivityContent(
            state: state,
            staleDate: nil
        )

        for activity in Activity<HushRestAttributes>.activities {
            await activity.end(
                finalContent,
                dismissalPolicy: .immediate
            )
        }

        isLiveActivityActive = false
    }

    private func removeOrphanedActivities() async {
        guard !Activity<HushRestAttributes>.activities.isEmpty else {
            return
        }

        await endAllActivities(
            finalPhase: .ended,
            remainingSeconds: 0
        )
    }
}
