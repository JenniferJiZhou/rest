import Combine
import FamilyControls
import SwiftUI
import UIKit

@main
struct HushApp: App {
    @UIApplicationDelegateAdaptor(HushAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            HushPhoneRootView()
        }
    }
}

private struct HushPhoneRootView: View {
    @State private var isShowingCompanion = false
    @State private var isShowingSettings = false

    var body: some View {
        HushDemoRootView(
            onSettings: {
                isShowingSettings = true
            },
            onCompanion: {
                isShowingCompanion = true
            }
        )
        .sheet(isPresented: $isShowingSettings) {
            HushSettingsView()
        }
        .fullScreenCover(isPresented: $isShowingCompanion) {
            HushAlwaysOnCompanionView {
                isShowingCompanion = false
            }
        }
    }
}

private struct HushPlaceholderView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var isShowingCompanion = false
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

                companionModeCard

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
        .fullScreenCover(isPresented: $isShowingCompanion) {
            HushAlwaysOnCompanionView {
                isShowingCompanion = false
            }
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

    private var companionModeCard: some View {
        Button {
            isShowingCompanion = true
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "waveform.path.ecg")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(.black, in: Circle())

                VStack(alignment: .leading, spacing: 4) {
                    Text("常亮陪伴")
                        .font(.headline)
                        .foregroundStyle(.primary)

                    Text("接续电脑上的工作节奏，在该休息时轻轻提醒你。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .background(
                Color.primary.opacity(0.055),
                in: RoundedRectangle(cornerRadius: 20)
            )
        }
        .buttonStyle(.plain)
        .accessibilityHint("打开常亮工作陪伴")
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

private struct HushCompanionSnapshot {
    let deviceName: String
    let currentContext: String
    let continuousMinutes: Int
    let dailyMinutes: Int
}

private protocol HushCompanionSnapshotProviding {
    func currentSnapshot() async -> HushCompanionSnapshot
}

private struct FixtureHushCompanionSnapshotProvider:
    HushCompanionSnapshotProviding
{
    func currentSnapshot() async -> HushCompanionSnapshot {
        HushCompanionSnapshot(
            deviceName: "Jennifer 的 Mac",
            currentContext: "Xcode · Hush",
            continuousMinutes: 37,
            dailyMinutes: 104
        )
    }
}

@MainActor
private final class HushAlwaysOnCompanionModel: ObservableObject {
    enum Phase: Equatable {
        case idle
        case working
        case approachingRest
        case restSuggested
        case resting
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var snapshot: HushCompanionSnapshot?
    @Published private(set) var elapsedSeconds = 0
    @Published private(set) var restSeconds = 0

    private let provider: any HushCompanionSnapshotProviding
    private var timer: AnyCancellable?
    private var nextOfferAtElapsedSeconds = 50 * 60

    init(
        provider: any HushCompanionSnapshotProviding =
            FixtureHushCompanionSnapshotProvider()
    ) {
        self.provider = provider
    }

    var isSessionActive: Bool {
        phase != .idle
    }

    var formattedElapsed: String {
        format(seconds: elapsedSeconds)
    }

    var formattedRest: String {
        format(seconds: restSeconds)
    }

    var statusText: String {
        switch phase {
        case .idle:
            return "准备好后，让 Hush 在旁边陪你工作。"
        case .working:
            return "节奏平稳，先继续手上的事情。"
        case .approachingRest:
            return "快到休息点了，把这一小段收个尾。"
        case .restSuggested:
            return "该把注意力从屏幕上移开一会儿了。"
        case .resting:
            return "不用赶时间，慢慢回来。"
        }
    }

    func start() async {
        snapshot = await provider.currentSnapshot()
        elapsedSeconds = (snapshot?.continuousMinutes ?? 0) * 60
        nextOfferAtElapsedSeconds = max(50 * 60, elapsedSeconds + 60)
        phase = elapsedSeconds >= 45 * 60 ? .approachingRest : .working
        setScreenAwake(true)
        startTimer()
    }

    func stop() {
        timer?.cancel()
        timer = nil
        phase = .idle
        setScreenAwake(false)
    }

    func refreshScreenAwake(isSceneActive: Bool) {
        setScreenAwake(isSceneActive && isSessionActive)
    }

    func simulateAgentRestDecision() {
        guard phase == .working || phase == .approachingRest else {
            return
        }

        offerRest()
    }

    func beginRest() {
        restSeconds = 0
        phase = .resting
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
    }

    func remindLater() {
        nextOfferAtElapsedSeconds = elapsedSeconds + 5 * 60
        phase = .working
    }

    func skipCurrentSuggestion() {
        nextOfferAtElapsedSeconds = elapsedSeconds + 30 * 60
        phase = .working
    }

    func finishRest() {
        restSeconds = 0
        elapsedSeconds = 0
        nextOfferAtElapsedSeconds = 50 * 60
        phase = .working
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    private func startTimer() {
        timer?.cancel()
        timer = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.tick()
            }
    }

    private func tick() {
        switch phase {
        case .working, .approachingRest:
            elapsedSeconds += 1
            if elapsedSeconds >= nextOfferAtElapsedSeconds {
                offerRest()
            } else if elapsedSeconds >= nextOfferAtElapsedSeconds - 5 * 60,
                      phase == .working
            {
                phase = .approachingRest
            }
        case .resting:
            restSeconds += 1
        case .idle, .restSuggested:
            break
        }
    }

    private func offerRest() {
        phase = .restSuggested
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }

    private func setScreenAwake(_ awake: Bool) {
        UIApplication.shared.isIdleTimerDisabled = awake
    }

    private func format(seconds: Int) -> String {
        let minutes = seconds / 60
        let remainder = seconds % 60
        return String(format: "%02d:%02d", minutes, remainder)
    }
}

private struct HushAlwaysOnCompanionView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = HushAlwaysOnCompanionModel()
    @State private var isShowingFocusGuide = false

    let onClose: () -> Void

    var body: some View {
        ZStack {
            HushWaveBackground()

            VStack(spacing: 0) {
                header

                Spacer(minLength: 24)

                if model.phase == .restSuggested || model.phase == .resting {
                    restContent
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else {
                    workContent
                        .transition(.opacity)
                }

                Spacer(minLength: 20)

                footer
            }
            .padding(.horizontal, 24)
            .padding(.top, 12)
            .padding(.bottom, 20)
        }
        .preferredColorScheme(.dark)
        .task {
            guard model.phase == .idle else { return }
            await model.start()
        }
        .onChange(of: scenePhase) { _, phase in
            model.refreshScreenAwake(isSceneActive: phase == .active)
        }
        .onDisappear {
            model.stop()
        }
        .alert("让工作时段安静下来", isPresented: $isShowingFocusGuide) {
            Button("知道了", role: .cancel) {}
        } message: {
            Text(
                "从控制中心开启“专注模式”，并在系统设置里只允许 Hush 的休息提醒。iOS 不允许 Hush 自动关闭其他 App 的通知。"
            )
        }
    }

    private var header: some View {
        HStack {
            Button {
                model.stop()
                onClose()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 36, height: 36)
                    .background(Color.white.opacity(0.08), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("结束常亮陪伴")

            Spacer()

            HStack(spacing: 7) {
                Circle()
                    .fill(Color.white.opacity(0.72))
                    .frame(width: 5, height: 5)
                Text("常亮中")
                    .font(.caption)
                    .tracking(0.8)
                    .foregroundStyle(Color.white.opacity(0.66))
            }

            Spacer()

            Button {
                isShowingFocusGuide = true
            } label: {
                Image(systemName: "moon.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 36, height: 36)
                    .background(Color.white.opacity(0.08), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("专注模式说明")
        }
        .foregroundStyle(.white)
    }

    private var workContent: some View {
        VStack(spacing: 26) {
            HStack(spacing: 7) {
                Image(systemName: "laptopcomputer")
                Text(model.snapshot?.deviceName ?? "正在接续 Mac…")
            }
            .font(.caption)
            .foregroundStyle(Color.white.opacity(0.52))

            VStack(spacing: 9) {
                Text(model.formattedElapsed)
                    .font(
                        .system(
                            size: 78,
                            weight: .ultraLight,
                            design: .rounded
                        )
                        .monospacedDigit()
                    )
                    .contentTransition(.numericText())

                Text("连续工作")
                    .font(.subheadline)
                    .tracking(1.4)
                    .foregroundStyle(.secondary)
            }

            Text(model.statusText)
                .font(.body)
                .foregroundStyle(Color.white.opacity(0.78))
                .multilineTextAlignment(.center)

            if let snapshot = model.snapshot {
                HStack(spacing: 9) {
                    Text(snapshot.currentContext)
                    Text("·")
                        .foregroundStyle(Color.white.opacity(0.24))
                    Text("今天 \(snapshot.dailyMinutes) 分钟")
                }
                .font(.caption)
                .foregroundStyle(Color.white.opacity(0.48))
            }
        }
        .animation(.easeInOut(duration: 0.35), value: model.phase)
    }

    private var restContent: some View {
        VStack(spacing: 22) {
            Image(systemName: "wind")
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(Color.white.opacity(0.88))

            VStack(spacing: 10) {
                Text(model.phase == .resting ? "正在休息" : "该休息一下了")
                    .font(.system(size: 30, weight: .medium, design: .rounded))

                if model.phase == .resting {
                    Text(model.formattedRest)
                        .font(.system(size: 48, weight: .light, design: .rounded))
                        .monospacedDigit()
                } else {
                    Text("站起来，去窗边看一眼远处。\n慢慢呼吸三次。")
                        .font(.title3)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Color.white.opacity(0.82))
                        .lineSpacing(7)
                }
            }

            if model.phase == .restSuggested {
                Button("开始休息") {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        model.beginRest()
                    }
                }
                .buttonStyle(HushCompanionPrimaryButtonStyle())

                HStack(spacing: 22) {
                    Button("5 分钟后") {
                        withAnimation {
                            model.remindLater()
                        }
                    }
                    Button("这次跳过") {
                        withAnimation {
                            model.skipCurrentSuggestion()
                        }
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            } else {
                Button("我休息好了") {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        model.finishRest()
                    }
                }
                .buttonStyle(HushCompanionPrimaryButtonStyle())
            }
        }
    }

    private var footer: some View {
        VStack(spacing: 12) {
            if model.phase == .working || model.phase == .approachingRest {
                Button {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        model.simulateAgentRestDecision()
                    }
                } label: {
                    Image(systemName: "bell.badge")
                        .font(.system(size: 13, weight: .regular))
                        .frame(width: 34, height: 34)
                        .background(Color.white.opacity(0.045), in: Circle())
                }
                .foregroundStyle(Color.white.opacity(0.68))
                .accessibilityLabel("模拟 Agent 建议休息")
            }

            HStack(spacing: 7) {
                Circle()
                    .fill(Color.green.opacity(0.9))
                    .frame(width: 6, height: 6)
                Text("屏幕保持常亮 · Mac / Agent Fixture")
                    .font(.caption2)
                    .foregroundStyle(Color.white.opacity(0.48))
            }
        }
    }

}

private struct HushCompanionPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(
                Color.white.opacity(configuration.isPressed ? 0.72 : 0.94),
                in: Capsule()
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
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
    @ObservedObject private var sleepSchedule =
        HushSleepScheduleController.shared
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

                Section("睡前模式") {
                    Toggle(
                        "按时间进入睡前模式",
                        isOn: $sleepSchedule.isEnabled
                    )

                    DatePicker(
                        "通常几点睡觉",
                        selection: $sleepSchedule.sleepTime,
                        displayedComponents: .hourAndMinute
                    )
                    .disabled(!sleepSchedule.isEnabled)

                    Button("立即预览睡前模式") {
                        sleepSchedule.previewNow()
                        dismiss()
                    }

                    Text(
                        "Hush 在前台时会直接进入；在后台时会发送通知，由你点击进入。"
                    )
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
