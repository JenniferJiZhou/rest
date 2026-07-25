import AppKit
import SwiftUI
import UserNotifications

struct HushMacRestSuggestion: Codable, Equatable, Sendable {
    let requestID: String
    let message: String
    let generatedTask: GeneratedRestTask
}

extension Notification.Name {
    static let hushMacRestNotificationOpened = Notification.Name(
        "hush.mac.rest-notification-opened"
    )
}

final class HushMacRestNotificationController:
    NSObject,
    UNUserNotificationCenterDelegate
{
    static let shared = HushMacRestNotificationController()

    private static let storedSuggestionKey =
        "mac.notifications.lastOpenedRestSuggestion"
    private static let companionMessageKey =
        "mac.agent.lastCompanionMessage"
    private static let requestIDKey = "request_id"
    private static let messageKey = "message"
    private static let taskTitleKey = "generated_task_title"
    private static let taskDurationSecondsKey =
        "generated_task_duration_seconds"
    private static let taskStepsKey = "generated_task_steps"

    private override init() {
        super.init()
    }

    func configure() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func sendRestSuggestion(
        message: String,
        generatedTask: GeneratedRestTask,
        requestID: String
    ) {
        UserDefaults.standard.removeObject(
            forKey: Self.companionMessageKey
        )
        let trimmedMessage = message.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let content = UNMutableNotificationContent()
        content.title = "Hush 提醒你休息一下"
        content.body = trimmedMessage.isEmpty
            ? "有一个很短的休息任务在等你。"
            : trimmedMessage
        content.sound = .default
        content.userInfo = [
            Self.requestIDKey: requestID,
            Self.messageKey: trimmedMessage,
            Self.taskTitleKey: generatedTask.title,
            Self.taskDurationSecondsKey: generatedTask.durationSeconds,
            Self.taskStepsKey: generatedTask.steps
        ]

        let request = UNNotificationRequest(
            identifier: "hush-rest-\(requestID)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    func updateCompanionMessage(_ message: String) {
        let trimmedMessage = message.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        if trimmedMessage.isEmpty {
            UserDefaults.standard.removeObject(
                forKey: Self.companionMessageKey
            )
        } else {
            UserDefaults.standard.set(
                trimmedMessage,
                forKey: Self.companionMessageKey
            )
        }
        NotificationCenter.default.post(
            name: .hushCompanionMessageUpdated,
            object: trimmedMessage
        )
    }

    func lastCompanionMessage() -> String? {
        UserDefaults.standard.string(
            forKey: Self.companionMessageKey
        )
    }

    func sendTestSuggestion() {
        sendRestSuggestion(
            message: "先把手机留在这里，去洗一把脸。",
            generatedTask: GeneratedRestTask(
                title: "一分钟桌边重置",
                durationSeconds: 60,
                steps: [
                    "暂时让双手离开键盘",
                    "看向比屏幕更远的位置",
                    "肩膀放松后再回来"
                ]
            ),
            requestID: "req_mac_notification_test_\(UUID().uuidString)"
        )
    }

    func lastOpenedSuggestion() -> HushMacRestSuggestion? {
        guard
            let data = UserDefaults.standard.data(
                forKey: Self.storedSuggestionKey
            )
        else {
            return nil
        }

        return try? JSONDecoder().decode(
            HushMacRestSuggestion.self,
            from: data
        )
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler:
            @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        if userInfo[HushSleepScheduleController.routeUserInfoKey]
            as? String == HushSleepScheduleController.sleepRouteValue
        {
            DispatchQueue.main.async {
                NSApplication.shared.activate(ignoringOtherApps: true)
                HushSleepScheduleController.shared
                    .requestSleepHandoff()
                completionHandler()
            }
            return
        }

        let suggestion = Self.suggestion(
            from: userInfo
        )

        if let suggestion,
           let data = try? JSONEncoder().encode(suggestion)
        {
            UserDefaults.standard.set(
                data,
                forKey: Self.storedSuggestionKey
            )
        }

        DispatchQueue.main.async {
            NSApplication.shared.activate(ignoringOtherApps: true)
            NotificationCenter.default.post(
                name: .hushMacRestNotificationOpened,
                object: suggestion
            )
            completionHandler()
        }
    }

    private static func suggestion(
        from userInfo: [AnyHashable: Any]
    ) -> HushMacRestSuggestion? {
        guard let requestID = userInfo[requestIDKey] as? String else {
            return nil
        }

        let message = userInfo[messageKey] as? String ?? ""
        guard
            let title = userInfo[taskTitleKey] as? String,
            let durationSeconds =
                userInfo[taskDurationSecondsKey] as? Int,
            let steps = userInfo[taskStepsKey] as? [String]
        else {
            return nil
        }
        return HushMacRestSuggestion(
            requestID: requestID,
            message: message,
            generatedTask: GeneratedRestTask(
                title: title,
                durationSeconds: durationSeconds,
                steps: steps
            )
        )
    }
}

@main
struct HushMacApp: App {
    @StateObject private var model = MacUsageMonitoringModel()
    @StateObject private var websiteModel = MacWebsiteMonitoringModel()

    init() {
        HushMacRestNotificationController.shared.configure()
    }

    var body: some Scene {
        MenuBarExtra {
            HushMacMenuView(model: model)
        } label: {
            HushMacMenuBarLabel()
        }

        Window("Hush", id: "main") {
            HushMacHomeView()
        }
        .defaultSize(width: 900, height: 680)
        .windowStyle(.hiddenTitleBar)

        Window("Hush 设置", id: "settings") {
            HushMacDashboardView(
                model: model,
                websiteModel: websiteModel
            )
                .frame(minWidth: 820, minHeight: 560)
        }
        .defaultSize(width: 860, height: 610)
        .windowStyle(.hiddenTitleBar)
    }
}

private struct HushMacMenuBarLabel: View {
    @Environment(\.openWindow) private var openWindow
    @State private var didOpenMainWindow = false

    var body: some View {
        Image(systemName: "waveform.path")
            .accessibilityLabel(HushProduct.displayName)
            .task {
                guard !didOpenMainWindow else { return }
                didOpenMainWindow = true
                openWindow(id: "main")
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
            .onReceive(
                NotificationCenter.default.publisher(
                    for: .hushMacRestNotificationOpened
                )
            ) { _ in
                openWindow(id: "main")
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
            .onReceive(
                NotificationCenter.default.publisher(
                    for: .hushSleepHandoffRequested
                )
            ) { _ in
                openWindow(id: "main")
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
    }
}

private struct HushMacMenuView: View {
    @Environment(\.openWindow) private var openWindow
    @ObservedObject var model: MacUsageMonitoringModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 9) {
                Image(systemName: "waveform.path")
                    .foregroundStyle(.cyan)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Hush")
                        .font(.headline)
                    Text(model.isMonitoring ? "正在监测" : "尚未启动")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            HStack {
                Label("连续使用", systemImage: "timer")
                Spacer()
                Text(model.currentContinuousDisplay)
                    .foregroundStyle(.secondary)
            }

            HStack {
                Label("今日累计", systemImage: "chart.bar")
                Spacer()
                Text(model.currentDailyDisplay)
                    .foregroundStyle(.secondary)
            }

            Divider()

            Button("打开 Hush") {
                openWindow(id: "main")
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
            .keyboardShortcut("o")

            Button("设置") {
                openWindow(id: "settings")
                NSApplication.shared.activate(ignoringOtherApps: true)
            }
            .keyboardShortcut(",")

            Button("退出 Hush") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        }
        .padding(12)
        .frame(width: 260)
    }
}

private struct HushMacHomeView: View {
    @Environment(\.openWindow) private var openWindow
    @State private var suggestion =
        HushMacRestNotificationController.shared.lastOpenedSuggestion()

    var body: some View {
        HushDemoRootView(
            onSettings: {
                openWindow(id: "settings")
                NSApplication.shared.activate(ignoringOtherApps: true)
            },
            suggestedGeneratedTask: suggestion?.generatedTask,
            initialCompanionMessage:
                HushMacRestNotificationController.shared
                    .lastCompanionMessage(),
            suggestionMessage: suggestion?.message,
            suggestionEventID: suggestion?.requestID
        )
        .frame(minWidth: 620, minHeight: 560)
        .onReceive(
            NotificationCenter.default.publisher(
                for: .hushMacRestNotificationOpened
            )
        ) { notification in
            suggestion = notification.object as? HushMacRestSuggestion
                ?? HushMacRestNotificationController.shared
                    .lastOpenedSuggestion()
        }
    }
}

private struct HushMacDashboardView: View {
    @ObservedObject var model: MacUsageMonitoringModel
    @ObservedObject var websiteModel: MacWebsiteMonitoringModel
    @ObservedObject private var sleepSchedule =
        HushSleepScheduleController.shared
    @State private var isShowingAppPicker = false

    var body: some View {
        ZStack {
            HushMacBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header

                    HStack(alignment: .top, spacing: 18) {
                        VStack(spacing: 18) {
                            currentActivityCard
                            websiteMonitoringCard
                            monitoredAppsCard
                        }
                        .frame(maxWidth: .infinity)

                        VStack(spacing: 18) {
                            sleepScheduleCard
                            interruptionCard
                            agentCard
                            privacyCard
                        }
                        .frame(width: 285)
                    }

                    Text("关注的 App 或网站连续使用满 5 分钟时，Hush 会向已配置的 Agent 发起检查。")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.48))
                        .frame(maxWidth: .infinity, alignment: .center)
                }
                .padding(28)
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $isShowingAppPicker) {
            HushMacAppPickerView(model: model)
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 5) {
                Text("HUSH · MAC")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .tracking(1.5)
                    .foregroundStyle(.white.opacity(0.56))

                Text("把注意力还给自己")
                    .font(.system(size: 29, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.96))
            }

            Spacer()

            Label(
                model.isMonitoring ? "正在监测" : "尚未启动",
                systemImage: model.isMonitoring
                    ? "checkmark.circle.fill"
                    : "pause.circle.fill"
            )
            .font(.system(size: 12, weight: .medium, design: .rounded))
            .foregroundStyle(
                model.isMonitoring
                    ? Color.mint
                    : Color.white.opacity(0.62)
            )
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(.white.opacity(0.08), in: Capsule())
            .overlay(Capsule().stroke(.white.opacity(0.12), lineWidth: 1))
        }
    }

    private var currentActivityCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            sectionLabel("当前活动")

            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                        .fill(.white.opacity(0.09))

                    if let currentApplication = model.currentApplication {
                        Image(
                            nsImage: model.icon(
                                for: currentApplication
                            )
                        )
                        .resizable()
                        .scaledToFit()
                        .padding(9)
                    } else {
                        Image(systemName: "macwindow")
                            .font(.system(size: 25, weight: .light))
                            .foregroundStyle(.cyan.opacity(0.88))
                    }
                }
                .frame(width: 54, height: 54)

                VStack(alignment: .leading, spacing: 4) {
                    Text("当前前台 App")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.52))
                    Text(model.currentAppLabel)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.94))

                    if model.currentApplication != nil {
                        Text(
                            model.currentAppIsMonitored
                                ? "已加入关注范围"
                                : "未加入关注范围"
                        )
                        .font(.caption2)
                        .foregroundStyle(
                            model.currentAppIsMonitored
                                ? Color.mint.opacity(0.85)
                                : Color.white.opacity(0.4)
                        )
                    }
                }
            }

            HStack(spacing: 12) {
                metric(
                    title: "连续使用",
                    value: model.currentContinuousDisplay,
                    unit: "分:秒"
                )
                metric(
                    title: "今日累计",
                    value: model.currentDailyDisplay,
                    unit: "分:秒"
                )
            }

            Button {
                if model.isMonitoring {
                    model.stopMonitoring()
                    websiteModel.stopMonitoring()
                } else {
                    model.startMonitoring()
                    websiteModel.startMonitoring()
                }
            } label: {
                Label(
                    model.isMonitoring ? "停止监测" : "开始监测",
                    systemImage: model.isMonitoring
                        ? "stop.fill"
                        : "play.fill"
                )
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(HushMacPrimaryButtonStyle())
        }
        .hushMacPanel(emphasized: true)
    }

    private var websiteMonitoringCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                sectionLabel("浏览器内网站")
                Spacer()
                Text("Safari · Chrome")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.45))
            }

            HStack(spacing: 12) {
                Image(systemName: "globe")
                    .font(.system(size: 24, weight: .light))
                    .foregroundStyle(.cyan.opacity(0.85))
                    .frame(width: 38)

                VStack(alignment: .leading, spacing: 3) {
                    Text(websiteModel.currentDomain ?? "尚未识别网站")
                        .font(.system(size: 15, weight: .semibold))
                    Text(
                        websiteModel.currentBrowserName
                            ?? "打开受支持的浏览器后自动发现"
                    )
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.5))
                }
            }

            HStack(spacing: 12) {
                metric(
                    title: "网站连续使用",
                    value: websiteModel.currentContinuousDisplay,
                    unit: "分:秒"
                )
                metric(
                    title: "网站今日累计",
                    value: websiteModel.currentDailyDisplay,
                    unit: "分:秒"
                )
            }

            Text(websiteModel.monitoringStatus)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.52))

            Toggle(
                "自动上传当前网站域名",
                isOn: $websiteModel.automaticallyUploadDomains
            )
            .toggleStyle(.switch)

            Text("关闭时仍在本地统计；点击发送按钮属于单次主动上传。")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.42))

            Button {
                websiteModel.sendCurrentWebsite()
            } label: {
                if websiteModel.isSendingRequest {
                    HStack {
                        ProgressView()
                            .controlSize(.small)
                        Text("正在请求…")
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text("发送当前网站数据")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .disabled(!websiteModel.currentWebsiteCanBeSent)

            Text(websiteModel.uploadStatus)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.52))

            if !websiteModel.frequentWebsites.isEmpty {
                Divider()
                    .overlay(.white.opacity(0.12))

                HStack {
                    Text("常用网站")
                        .font(.caption.weight(.semibold))
                    Spacer()
                    Text("按今日使用时间排序")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.4))
                }

                ForEach(websiteModel.frequentWebsites) { website in
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(website.domain)
                                    .font(
                                        .system(
                                            size: 13,
                                            weight: .semibold
                                        )
                                    )
                                Spacer()
                                Text(
                                    HushMacDurationFormatter.display(
                                        website.dailySeconds
                                    )
                                )
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.white.opacity(0.42))
                            }

                            TextField(
                                "可选：发送给 Agent 的名称",
                                text: Binding(
                                    get: {
                                        websiteModel.userProvidedName(
                                            for: website.domain
                                        )
                                    },
                                    set: { name in
                                        websiteModel.updateUserProvidedName(
                                            name,
                                            for: website.domain
                                        )
                                    }
                                )
                            )
                            .textFieldStyle(.roundedBorder)
                        }

                        Button {
                            websiteModel.forgetWebsite(website.domain)
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.white.opacity(0.38))
                        .help("清除 \(website.domain) 的本地记录")
                    }
                }
            }

            if let json = websiteModel.lastRequestJSON {
                DisclosureGroup("最近网站请求 JSON") {
                    ScrollView(.horizontal) {
                        Text(json)
                            .font(.system(.caption2, design: .monospaced))
                            .textSelection(.enabled)
                            .foregroundStyle(.white.opacity(0.72))
                            .padding(.top, 8)
                    }
                    .frame(maxHeight: 180)
                }
                .font(.caption)
                .foregroundStyle(.white.opacity(0.68))
            }
        }
        .hushMacPanel()
    }

    private var monitoredAppsCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                sectionLabel("关注的 App")
                Spacer()
                Text("\(model.monitoredAppCount) 个")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.5))
            }

            if model.monitoredApplications.isEmpty {
                HStack(spacing: 13) {
                    Image(systemName: "square.stack.3d.up.slash")
                        .font(.system(size: 22, weight: .light))
                        .foregroundStyle(.white.opacity(0.5))

                    VStack(alignment: .leading, spacing: 3) {
                        Text("还没有关注的 App")
                            .font(.system(size: 14, weight: .semibold))
                        Text("从当前正在运行或最近使用的 App 中选择。")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.5))
                    }
                }
            } else {
                ForEach(model.monitoredApplications) { application in
                    HStack(spacing: 11) {
                        Image(nsImage: model.icon(for: application))
                            .resizable()
                            .scaledToFit()
                            .frame(width: 32, height: 32)

                        VStack(alignment: .leading, spacing: 5) {
                            Text(application.systemDisplayName)
                                .font(.system(size: 13, weight: .semibold))

                            TextField(
                                "发送给 Agent 的名称",
                                text: Binding(
                                    get: {
                                        model.userProvidedName(
                                            for: application.bundleIdentifier
                                        )
                                    },
                                    set: { name in
                                        model.updateUserProvidedName(
                                            name,
                                            for: application.bundleIdentifier
                                        )
                                    }
                                )
                            )
                            .textFieldStyle(.roundedBorder)
                        }

                        Button {
                            model.removeMonitoredApplication(
                                bundleIdentifier:
                                    application.bundleIdentifier
                            )
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.white.opacity(0.38))
                        .help("移除 \(application.systemDisplayName)")
                    }
                }
            }

            Button("添加 App") {
                isShowingAppPicker = true
            }
                .buttonStyle(.bordered)
                .disabled(model.availableApplications.isEmpty)

            Text("Safari 和 Chrome 内的网站由上方网站监测处理，不会重复发送浏览器 App 检查点。")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.4))
        }
        .hushMacPanel()
    }

    private var interruptionCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionLabel("提醒方式")

            Picker(
                "提醒方式",
                selection: $model.interruptionMode
            ) {
                ForEach(
                    MacUsageMonitoringModel.InterruptionMode.allCases
                ) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .labelsHidden()
            .pickerStyle(.segmented)

            Text(
                model.interruptionMode == .gentle
                    ? "达到检查点后发送通知，由你决定何时进入 Hush。"
                    : "Agent 可以返回休息建议；Mac 强制遮挡将在后续实现。"
            )
            .font(.caption)
            .foregroundStyle(.white.opacity(0.52))
        }
        .hushMacPanel()
    }

    private var sleepScheduleCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionLabel("睡前模式")

            Toggle(
                "按时间自动进入",
                isOn: $sleepSchedule.isEnabled
            )
            .toggleStyle(.switch)

            DatePicker(
                "通常几点睡觉",
                selection: $sleepSchedule.sleepTime,
                displayedComponents: .hourAndMinute
            )
            .disabled(!sleepSchedule.isEnabled)

            Button("立即预览睡前模式") {
                sleepSchedule.previewNow()
            }
            .buttonStyle(.bordered)

            Text("到点后，Hush 会打开波浪主页并向下进入睡前交接。")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.52))
        }
        .hushMacPanel()
    }

    private var agentCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                sectionLabel("Agent")
                Spacer()
                Circle()
                    .fill(
                        model.isAgentConnected
                            ? Color.mint
                            : Color.orange
                    )
                    .frame(width: 7, height: 7)
            }

            Text(model.isAgentConnected ? "地址已配置" : "尚未配置")
                .font(.system(size: 17, weight: .semibold))

            TextField(
                "https://agent.example.com",
                text: $model.agentBaseURL
            )
            .textFieldStyle(.roundedBorder)

            Text(model.agentStatusMessage)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.52))

            Divider()
                .overlay(.white.opacity(0.12))

            VStack(alignment: .leading, spacing: 5) {
                Text("上次完成休息")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.45))
                Text(model.lastCompletedRestDisplay)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.75))
            }

            Button("记录刚刚完成休息") {
                model.recordRestCompleted()
            }
            .buttonStyle(.bordered)

            Button("发送测试通知") {
                HushMacRestNotificationController.shared
                    .sendTestSuggestion()
            }
            .buttonStyle(.bordered)

            Button {
                model.sendCurrentCheckpoint()
            } label: {
                if model.isSendingAgentRequest {
                    HStack {
                        ProgressView()
                            .controlSize(.small)
                        Text("正在请求…")
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text("发送当前数据")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!model.canSendCurrentCheckpoint)

            if let json = model.lastRequestJSON {
                DisclosureGroup("最近请求 JSON") {
                    ScrollView(.horizontal) {
                        Text(json)
                            .font(.system(.caption2, design: .monospaced))
                            .textSelection(.enabled)
                            .foregroundStyle(.white.opacity(0.72))
                            .padding(.top, 8)
                    }
                    .frame(maxHeight: 180)
                }
                .font(.caption)
                .foregroundStyle(.white.opacity(0.68))
            }
        }
        .hushMacPanel()
    }

    private var privacyCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("上传内容")

            privacyRow("用户填写的 App 名称", included: true)
            privacyRow("连续与累计时间", included: true)
            privacyRow("10 分钟内 App 切换次数", included: true)
            privacyRow("距上次休息的时间", included: true)
            privacyRow(
                "网站域名（打开自动上传后）",
                included: websiteModel.automaticallyUploadDomains
            )
            privacyRow("系统 App 名称 / Bundle ID", included: false)
            privacyRow("完整 URL / 搜索词 / 页面标题", included: false)
        }
        .hushMacPanel()
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .tracking(1.1)
            .foregroundStyle(.white.opacity(0.5))
    }

    private func metric(
        title: String,
        value: String,
        unit: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.5))

            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(value)
                    .font(
                        .system(
                            size: 30,
                            weight: .light,
                            design: .rounded
                        )
                    )
                    .monospacedDigit()

                Text(unit)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(15)
        .background(.black.opacity(0.14), in: RoundedRectangle(cornerRadius: 16))
    }

    private func privacyRow(
        _ title: String,
        included: Bool
    ) -> some View {
        HStack(spacing: 9) {
            Image(
                systemName: included
                    ? "checkmark.circle.fill"
                    : "minus.circle"
            )
            .foregroundStyle(
                included
                    ? Color.mint.opacity(0.88)
                    : Color.white.opacity(0.35)
            )

            Text(title)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.68))
        }
    }
}

private struct HushMacAppPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: MacUsageMonitoringModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("添加关注的 App")
                        .font(.title2.weight(.semibold))

                    Text("这里只显示当前正在运行或 Hush 最近发现的 App。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button("完成") {
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }

            if model.availableApplications.isEmpty {
                ContentUnavailableView(
                    "没有可添加的 App",
                    systemImage: "app.dashed",
                    description: Text(
                        "先打开一个其他 App，再回到 Hush。"
                    )
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(model.availableApplications) { application in
                    HStack(spacing: 12) {
                        Image(nsImage: model.icon(for: application))
                            .resizable()
                            .scaledToFit()
                            .frame(width: 34, height: 34)

                        VStack(alignment: .leading, spacing: 3) {
                            Text(application.systemDisplayName)
                                .font(.body.weight(.medium))
                            Text(application.bundleIdentifier)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Button("添加") {
                            model.addMonitoredApplication(application)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    }
                    .padding(.vertical, 4)
                }
                .listStyle(.inset)
            }

            Text("系统名称和 Bundle ID 只在本机用于识别 App，不会上传。")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(22)
        .frame(width: 520, height: 430)
    }
}

private struct HushMacBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.035, green: 0.045, blue: 0.11),
                    Color(red: 0.11, green: 0.10, blue: 0.25),
                    Color(red: 0.035, green: 0.045, blue: 0.11)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            TimelineView(
                .animation(
                    minimumInterval: 1.0 / 30.0,
                    paused: reduceMotion
                )
            ) { timeline in
                Canvas { context, size in
                    let elapsed =
                        timeline.date.timeIntervalSinceReferenceDate
                    let phase = reduceMotion
                        ? 0.8
                        : elapsed.truncatingRemainder(
                            dividingBy: 12
                        ) * 0.52
                    let centerY = size.height * 0.72

                    drawWave(
                        context: &context,
                        size: size,
                        centerY: centerY,
                        amplitude: min(66, size.height * 0.1),
                        frequency: 2.25,
                        phase: phase,
                        color: .cyan.opacity(0.48),
                        lineWidth: 1.8
                    )

                    drawWave(
                        context: &context,
                        size: size,
                        centerY: centerY + 8,
                        amplitude: min(45, size.height * 0.07),
                        frequency: 2.9,
                        phase: -phase * 0.7 + 1.3,
                        color: .purple.opacity(0.38),
                        lineWidth: 1.2
                    )
                }
            }

            LinearGradient(
                colors: [
                    .black.opacity(0.02),
                    .black.opacity(0.28)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .ignoresSafeArea()
    }

    private func drawWave(
        context: inout GraphicsContext,
        size: CGSize,
        centerY: CGFloat,
        amplitude: CGFloat,
        frequency: Double,
        phase: Double,
        color: Color,
        lineWidth: CGFloat
    ) {
        guard size.width > 0 else {
            return
        }

        var path = Path()
        let step = max(2, size.width / 240)

        for x in stride(
            from: 0.0,
            through: size.width,
            by: step
        ) {
            let progress = x / size.width
            let envelope = pow(
                max(0, sin(.pi * progress)),
                1.3
            )
            let y = centerY
                + sin(progress * .pi * 2 * frequency + phase)
                    * amplitude
                    * envelope

            if x == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }

        context.stroke(
            path,
            with: .color(color),
            style: StrokeStyle(
                lineWidth: lineWidth,
                lineCap: .round,
                lineJoin: .round
            )
        )
    }
}

private struct HushMacPanelModifier: ViewModifier {
    var emphasized = false

    func body(content: Content) -> some View {
        content
            .padding(19)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(
                        .white.opacity(emphasized ? 0.115 : 0.075)
                    )
                    .overlay(
                        RoundedRectangle(
                            cornerRadius: 22,
                            style: .continuous
                        )
                        .stroke(.white.opacity(0.12), lineWidth: 1)
                    )
            )
            .shadow(
                color: .black.opacity(0.16),
                radius: 24,
                y: 12
            )
    }
}

private extension View {
    func hushMacPanel(
        emphasized: Bool = false
    ) -> some View {
        modifier(HushMacPanelModifier(emphasized: emphasized))
    }
}

private struct HushMacPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 43)
            .background(
                LinearGradient(
                    colors: [.indigo, .purple],
                    startPoint: .leading,
                    endPoint: .trailing
                ),
                in: Capsule()
            )
            .opacity(isEnabled ? 1 : 0.38)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

private enum HushMacDurationFormatter {
    static func display(_ duration: TimeInterval) -> String {
        let totalSeconds = max(0, Int(duration))
        return String(
            format: "%d:%02d",
            totalSeconds / 60,
            totalSeconds % 60
        )
    }
}
