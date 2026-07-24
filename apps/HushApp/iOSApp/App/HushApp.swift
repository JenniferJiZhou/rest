import FamilyControls
import SwiftUI

@main
struct HushApp: App {
    @UIApplicationDelegateAdaptor(HushAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            HushPlaceholderView()
        }
    }
}

private struct HushPlaceholderView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var isShowingSettings = false
    @StateObject private var restSession = RestSessionLiveActivityModel()
    @StateObject private var lockdown = LockdownCoordinator()

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text(HushProduct.displayName)
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                if let activeLockdown = lockdown.activeState {
                    lockdownCard(activeLockdown)
                }

                Text("我现在需要休息")
                    .font(.headline)

                restSessionCard
            }
            .padding()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("设置")
                }
            }
        }
        .sheet(isPresented: $isShowingSettings) {
            HushSettingsView()
        }
        .task {
            await restSession.restoreIfNeeded()
            lockdown.refresh()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else {
                return
            }

            lockdown.refresh()
        }
        .onChange(of: restSession.phase) { _, phase in
            guard phase == .idle || phase == .completed else {
                return
            }

            lockdown.refresh()
        }
    }

    private func lockdownCard(
        _ activeLockdown: HushLockdownState
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(
                "强提醒已启用",
                systemImage: "lock.shield.fill"
            )
            .font(.headline)
            .foregroundStyle(.indigo)

            Text(activeLockdown.userProvidedContextLabel)
                .font(.title3.weight(.semibold))

            Text(
                activeLockdown.message.isEmpty
                    ? "这个 App 已暂时锁定。先把一分钟留给自己吧。"
                    : activeLockdown.message
            )
            .font(.body)
            .foregroundStyle(.secondary)

            if restSession.phase == .running
                || restSession.phase == .paused
            {
                Text("休息完成或提前结束后会自动解除锁定。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Button("开始休息") {
                    Task {
                        await restSession.start()
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.indigo)

                HStack {
                    Button("稍后提醒") {
                        lockdown.release()
                    }
                    .buttonStyle(.bordered)

                    Button("这次跳过", role: .cancel) {
                        lockdown.release()
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            .indigo.opacity(0.1),
            in: RoundedRectangle(cornerRadius: 20)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(.indigo.opacity(0.25), lineWidth: 1)
        )
    }

    private var restSessionCard: some View {
        VStack(spacing: 14) {
            Text(restSession.sessionName)
                .font(.title3.weight(.semibold))

            if restSession.phase != .idle {
                Text(restSession.formattedRemainingTime)
                    .font(.system(.largeTitle, design: .rounded).monospacedDigit())
                    .contentTransition(.numericText())
                    .accessibilityLabel("剩余 \(restSession.formattedRemainingTime)")
            }

            Text(restSession.phaseMessage)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            restSessionActions

            if let errorMessage = restSession.errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(.indigo.opacity(0.08), in: RoundedRectangle(cornerRadius: 20))
    }

    @ViewBuilder
    private var restSessionActions: some View {
        switch restSession.phase {
        case .idle:
            Button("开始休息") {
                Task {
                    await restSession.start()
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.indigo)
        case .running:
            HStack {
                Button("暂停") {
                    Task {
                        await restSession.pause()
                    }
                }
                .buttonStyle(.bordered)

                Button("提前结束", role: .destructive) {
                    Task {
                        await restSession.endEarly()
                    }
                }
                .buttonStyle(.bordered)
            }
        case .paused:
            HStack {
                Button("继续") {
                    Task {
                        await restSession.resume()
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.indigo)

                Button("结束", role: .destructive) {
                    Task {
                        await restSession.endEarly()
                    }
                }
                .buttonStyle(.bordered)
            }
        case .completed:
            Button("再休息一分钟") {
                Task {
                    await restSession.startAgain()
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.indigo)
        }
    }
}

private struct HushSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var authorization = FamilyControlsAuthorizationModel()
    @StateObject private var selectionStore = FamilyActivitySelectionStore()
    @StateObject private var monitoring = DeviceActivityMonitoringModel()
    @StateObject private var notifications = NotificationAuthorizationModel()
    @StateObject private var interruptionMode = InterruptionModeModel()
    @StateObject private var agentSettings = AgentConnectionSettingsModel()
    @State private var isShowingActivityPicker = false

    var body: some View {
        NavigationStack {
            Form {
                Section("屏幕使用时间") {
                    Text(authorization.statusMessage)
                        .foregroundStyle(.secondary)

                    Button {
                        Task {
                            await authorization.requestAuthorization()
                        }
                    } label: {
                        if authorization.isRequestingAuthorization {
                            ProgressView()
                        } else {
                            Text("启用屏幕使用时间权限")
                        }
                    }
                    .disabled(authorization.isRequestingAuthorization)

                    if let errorMessage = authorization.errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                Section("关注范围") {
                    Text(selectionStore.selectionSummary)
                        .foregroundStyle(.secondary)

                    Button("选择要关注的 App") {
                        Task {
                            if !authorization.isAuthorized {
                                await authorization.requestAuthorization()
                            }

                            if authorization.isAuthorized {
                                isShowingActivityPicker = true
                            }
                        }
                    }
                    .disabled(authorization.isRequestingAuthorization)

                    ForEach(selectionStore.applicationContexts) { context in
                        VStack(alignment: .leading, spacing: 8) {
                            Label(context.token)

                            TextField(
                                "输入发送给 Agent 的名称",
                                text: Binding(
                                    get: {
                                        selectionStore.userProvidedName(
                                            for: context.id
                                        )
                                    },
                                    set: { name in
                                        selectionStore.updateUserProvidedName(
                                            name,
                                            for: context.id
                                        )
                                    }
                                )
                            )
                            .textInputAutocapitalization(.never)
                        }
                        .padding(.vertical, 4)
                    }

                    if let configurationMessage =
                        selectionStore.applicationConfigurationMessage
                    {
                        Text(configurationMessage)
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }

                    if selectionStore.selectedItemCount > 0 {
                        Button("清除选择", role: .destructive) {
                            monitoring.stopMonitoring()
                            selectionStore.clearSelection()
                        }
                    }

                    Text("系统 App 名称仅在本机显示；发送给 Agent 的名称由你逐个填写。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("设备活动监测") {
                    Picker("提醒方式", selection: $interruptionMode.mode) {
                        ForEach(InterruptionModeModel.Mode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)

                    Text(interruptionMode.mode.detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    TextField(
                        "https://agent.example.com",
                        text: $agentSettings.baseURL
                    )
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                    Text(agentSettings.statusMessage)
                        .font(.footnote)
                        .foregroundStyle(
                            agentSettings.isConfigured
                                ? Color.secondary
                                : Color.orange
                        )

                    if let lastResultMessage = agentSettings.lastResultMessage {
                        Text(lastResultMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Text(monitoring.monitoringStatusMessage)
                        .foregroundStyle(.secondary)

                    Text(monitoring.lastThresholdMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Button(
                        monitoring.isMonitoring
                            ? "更新每 5 分钟云端检查"
                            : "启动每 5 分钟云端检查"
                    ) {
                        monitoring.startMonitoring(
                            applicationContexts:
                                selectionStore.configuredApplicationContexts
                        )
                    }
                    .disabled(
                        !authorization.isAuthorized
                            || !selectionStore.allApplicationNamesConfigured
                            || !agentSettings.isConfigured
                            || !notifications.isAuthorized
                    )

                    if monitoring.isMonitoring {
                        Button("停止监测", role: .destructive) {
                            monitoring.stopMonitoring()
                        }
                    }

                    if let errorMessage = monitoring.errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Text("每个 App 独立累计使用时间；达到检查点时，同时发送当天累计时间和估算连续时间。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("休息提醒") {
                    Text(notifications.statusMessage)
                        .foregroundStyle(.secondary)

                    if !notifications.isAuthorized {
                        Button {
                            Task {
                                await notifications.requestAuthorization()
                            }
                        } label: {
                            if notifications.isRequestingAuthorization {
                                ProgressView()
                            } else {
                                Text("启用休息提醒通知")
                            }
                        }
                        .disabled(notifications.isRequestingAuthorization)
                    }

                    Button("发送测试提醒") {
                        Task {
                            await notifications.sendTestReminder()
                        }
                    }
                    .disabled(!notifications.isAuthorized)

                    if let errorMessage = notifications.errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Text("达到监测阈值后，Hush 最多每 2 小时提醒一次，每天最多 3 次。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") {
                        dismiss()
                    }
                }
            }
            .task {
                authorization.refreshStatus()
                monitoring.refreshStatus()
                agentSettings.refreshLastResult()
                await notifications.refreshStatus()
            }
            .familyActivityPicker(
                headerText: "选择希望 Hush 关注的 App、类别或网站",
                footerText: "Hush 不会读取你的具体使用内容。",
                isPresented: $isShowingActivityPicker,
                selection: $selectionStore.selection
            )
            .onChange(of: isShowingActivityPicker) { _, isPresented in
                guard !isPresented else {
                    return
                }

                updateMonitoringAfterSelectionChange()
            }
        }
    }

    private func updateMonitoringAfterSelectionChange() {
        guard monitoring.isMonitoring else {
            return
        }

        if selectionStore.selectedItemCount == 0 {
            monitoring.stopMonitoring()
        } else if selectionStore.allApplicationNamesConfigured {
            monitoring.startMonitoring(
                applicationContexts:
                    selectionStore.configuredApplicationContexts
            )
        } else {
            monitoring.stopMonitoring()
        }
    }
}
