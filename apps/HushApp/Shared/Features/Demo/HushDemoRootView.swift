import SwiftUI

struct HushDemoRootView: View {
    @StateObject private var store: HushDemoStore
    @ObservedObject private var sleepSchedule =
        HushSleepScheduleController.shared
    @State private var isShowingSettings = false
    @State private var isOfferingBreath = false
    @State private var isBreathing = false
    @State private var isGeneratingRestTask = false
    @State private var companionMessage: String?
    @State private var openedSuggestionMessage: String?
    private let onSettings: (() -> Void)?
    private let onCompanion: (() -> Void)?
    private let suggestedQuestID: String?
    private let suggestedGeneratedTask: GeneratedRestTask?
    private let suggestionMessage: String?
    private let suggestionEventID: String?

    @MainActor
    init(
        provider: any HushRestContentProviding = BundledHushRestContentProvider.automatic,
        initialQuestID: String? = nil,
        onSettings: (() -> Void)? = nil,
        onCompanion: (() -> Void)? = nil,
        suggestedQuestID: String? = nil,
        suggestedGeneratedTask: GeneratedRestTask? = nil,
        initialCompanionMessage: String? = nil,
        suggestionMessage: String? = nil,
        suggestionEventID: String? = nil
    ) {
        self.onSettings = onSettings
        self.onCompanion = onCompanion
        self.suggestedQuestID = suggestedQuestID
        self.suggestedGeneratedTask = suggestedGeneratedTask
        self.suggestionMessage = suggestionMessage
        self.suggestionEventID = suggestionEventID
        _companionMessage = State(
            initialValue: initialCompanionMessage
        )
        _store = StateObject(
            wrappedValue: HushDemoStore(
                provider: provider,
                initialQuestID: initialQuestID ?? suggestedQuestID,
                initialGeneratedRestTask: suggestedGeneratedTask
            )
        )
    }

    var body: some View {
        ZStack {
            HushWaveBackground()

            if store.route == .door {
                Group {
                    if isGeneratingRestTask {
                        HushRestTaskGeneratingView()
                    } else {
                        HushDoorView(
                            taskText: agentTaskText,
                            onOpenTask: openAgentTask,
                            onSettings: {
                                if let onSettings {
                                    onSettings()
                                } else {
                                    isShowingSettings = true
                                }
                            },
                            onInboxSwipeTriggered: store.openInbox,
                            onOpenCompanion: onCompanion,
                            onBreathLongPress: offerBreath
                        )
                    }
                }
                .transition(.opacity)
            } else if store.route == .inbox {
                UnifiedInboxView(onClose: store.closeInbox)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            } else {
                VStack(spacing: 0) {
                    topBar
                        .padding(.horizontal, HushSpacing.lg)
                        .padding(.top, HushSpacing.md)

                    ScrollView {
                        routeContent
                            .frame(maxWidth: 460)
                            .padding(.horizontal, HushSpacing.lg)
                            .padding(.top, HushSpacing.lg)
                            .padding(.bottom, HushSpacing.xl)
                    }
                    .scrollIndicators(.hidden)

                }
                .transition(
                    store.route == .sleepHandoff
                        ? .move(edge: .top).combined(with: .opacity)
                        : .opacity
                )
            }
        }
        #if os(macOS)
        .frame(
            minWidth: 380,
            idealWidth: 420,
            minHeight: 580,
            idealHeight: 700
        )
        #else
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        #endif
        .overlay {
            if isOfferingBreath {
                ZStack {
                    Color.black.opacity(0.55)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture { isOfferingBreath = false }

                    HushBreathInviteView(
                        onAccept: {
                            isOfferingBreath = false
                            isBreathing = true
                        },
                        onDismiss: { isOfferingBreath = false }
                    )
                }
                .transition(.opacity)
            }
        }
        .overlay {
            if isBreathing {
                HushBreathTideView { isBreathing = false }
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.28), value: isOfferingBreath)
        .animation(.easeInOut(duration: 0.45), value: isBreathing)
        .preferredColorScheme(.dark)
        .task {
            if sleepSchedule.consumePendingRoute() {
                store.startSleepHandoff()
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: .hushSleepHandoffRequested
            )
        ) { _ in
            store.startSleepHandoff()
        }
        .onChange(of: suggestionEventID) { _, _ in
            companionMessage = nil
            if let suggestedGeneratedTask {
                store.presentRestSuggestion(task: suggestedGeneratedTask)
            } else {
                store.presentRestSuggestion(questID: suggestedQuestID)
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: .hushDynamicRestSuggestionOpened
            )
        ) { notification in
            guard
                let suggestion =
                    notification.object as? HushDynamicRestSuggestion
            else {
                return
            }
            companionMessage = nil
            openedSuggestionMessage = suggestion.message
            store.presentRestSuggestion(task: suggestion.generatedTask)
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: .hushRestTaskGenerationStarted
            )
        ) { _ in
            isGeneratingRestTask = true
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: .hushRestTaskGenerationFinished
            )
        ) { _ in
            isGeneratingRestTask = false
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: .hushCompanionMessageUpdated
            )
        ) { notification in
            let message = (notification.object as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            companionMessage = message?.isEmpty == false ? message : nil
            openedSuggestionMessage = nil
            store.clearGeneratedRestSuggestion()
        }
        .sheet(isPresented: $isShowingSettings) {
            HushSettingsView(
                degraded: store.content.status.isFallback,
                onSwapTask: {
                    store.swapQuest()
                    isShowingSettings = false
                },
                onCheckIn: {
                    store.startCheckIn()
                    isShowingSettings = false
                },
                onDismiss: {
                    isShowingSettings = false
                }
            )
        }
    }

    private func offerBreath() {
        guard !isBreathing else { return }
        isOfferingBreath = true
    }

    private var agentTaskText: String {
        let openedMessage = openedSuggestionMessage?.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        if let openedMessage, !openedMessage.isEmpty {
            return openedMessage
        }

        if let suggestedQuestID,
           let quest = store.content.quests.first(
               where: { $0.id == suggestedQuestID }
           )
        {
            return taskText(for: quest)
        }

        let trimmedMessage = suggestionMessage?.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        if let trimmedMessage, !trimmedMessage.isEmpty {
            return trimmedMessage
        }

        if let generatedRestTask = store.generatedRestTask {
            return taskText(for: generatedRestTask.questContent)
        }

        if let companionMessage {
            return companionMessage
        }

        return taskText(for: store.currentQuest)
    }

    private func openAgentTask() {
        guard companionMessage == nil || store.generatedRestTask != nil else {
            return
        }
        store.openCurrentQuest()
    }

    private func taskText(for quest: HushQuestContent) -> String {
        let steps = quest.steps.prefix(2)
        let task = steps.isEmpty ? quest.title : steps.joined(separator: "\n")
        return task.hasSuffix("。") ? task : "\(task)。"
    }

    private var topBar: some View {
        HStack(spacing: HushSpacing.sm) {
            Group {
                if store.route == .door {
                    Color.clear
                } else {
                    Button(action: store.goBack) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(HushColor.textPrimary)
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(Color.white.opacity(0.08)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("返回")
                }
            }
            .frame(width: 30, height: 30)

            Spacer(minLength: HushSpacing.xs)

            HushSampleModeBadge(degraded: store.content.status.isFallback)

            Spacer(minLength: HushSpacing.xs)

            Button(action: store.reset) {
                Image(systemName: "arrow.counterclockwise")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(HushColor.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Color.white.opacity(0.06)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("重置演示")
        }
    }

    @ViewBuilder
    private var routeContent: some View {
        switch store.route {
        case .door:
            EmptyView()
        case .checkIn:
            FatigueCheckInView(
                description: $store.fatigueDescription,
                availableMinutes: $store.availableMinutes,
                onContinue: store.submitCheckIn
            )
        case .reflection:
            FatigueReflectionView(onChoose: store.choosePreference)
        case .quest:
            RestQuestView(
                quest: store.currentQuest,
                canSwap: store.generatedRestTask == nil
                    && store.content.quests.count > 1,
                onSwap: store.swapQuest,
                onStart: store.startSession,
                onRemindLater: generatedTaskRemindLaterAction,
                onDismiss: generatedTaskDismissAction
            )
        case .session:
            DayResetView(
                quest: store.currentQuest,
                prompt: store.currentDriftPrompt,
                onFinish: store.showFeedback
            )
        case .feedback:
            RestFeedbackView(onSubmit: store.completeReset)
        case .completed:
            RestCompletionView(onDone: store.reset)
        case .sleepHandoff:
            SleepHandoffView(
                todaySummary: $store.sleepTodaySummary,
                highlight: $store.sleepHighlight,
                tomorrowFirstStep: $store.sleepTomorrowFirstStep,
                onFinish: store.finishSleepHandoff
            )
        case .handoffRunning:
            HandoffRunningView(onShowResult: store.showPauseReceipt)
        case .pauseReceipt:
            PauseReceiptView(onBlueReset: store.startBlueReset)
        case .blueReset:
            BlueResetView(card: store.currentBlueBoxCard, onDone: store.reset)
        case .inbox:
            EmptyView()
        }
    }

    private var generatedTaskRemindLaterAction: (() -> Void)? {
        guard store.generatedRestTask != nil else {
            return nil
        }
        return { store.remindAboutGeneratedRestSuggestionLater() }
    }

    private var generatedTaskDismissAction: (() -> Void)? {
        guard store.generatedRestTask != nil else {
            return nil
        }
        return { store.dismissGeneratedRestSuggestion() }
    }
}

private struct HushRestTaskGeneratingView: View {
    var body: some View {
        VStack(spacing: HushSpacing.md) {
            ProgressView()
                .tint(Color.white.opacity(0.72))
            Text("Hush 正在为此刻留出一点空间……")
                .font(HushType.body)
                .foregroundStyle(Color.white.opacity(0.74))
                .multilineTextAlignment(.center)
        }
        .padding(HushSpacing.xl)
        .accessibilityElement(children: .combine)
    }
}

private struct HushSettingsView: View {
    let degraded: Bool
    let onSwapTask: () -> Void
    let onCheckIn: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(alignment: .leading, spacing: HushSpacing.lg) {
                HStack {
                    Text("设置")
                        .font(HushType.title)
                        .foregroundStyle(HushColor.textPrimary)

                    Spacer()

                    Button(action: onDismiss) {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(HushColor.textSecondary)
                            .frame(width: 32, height: 32)
                            .overlay(Circle().stroke(HushColor.hairline, lineWidth: 0.8))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("关闭设置")
                }

                HStack(spacing: HushSpacing.xs) {
                    Circle()
                        .fill(Color.white.opacity(0.82))
                        .frame(width: 6, height: 6)
                    Text(degraded ? "演示模式 · 备用内容" : "演示模式")
                        .font(HushType.micro)
                        .tracking(0.4)
                        .foregroundStyle(HushColor.textSecondary)
                }

                Divider()
                    .overlay(HushColor.hairline)

                VStack(spacing: 0) {
                    settingsRow("换一个任务", systemImage: "arrow.triangle.2.circlepath", action: onSwapTask)
                    settingsRow("描述我的疲惫", systemImage: "text.bubble", action: onCheckIn)
                }
            }
            .padding(HushSpacing.xl)
        }
        .frame(minWidth: 340, idealWidth: 380, minHeight: 300)
        .preferredColorScheme(.dark)
    }

    private func settingsRow(
        _ title: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: HushSpacing.sm) {
                Image(systemName: systemImage)
                    .frame(width: 20)
                Text(title)
                    .font(HushType.body)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(HushColor.textSecondary)
            }
            .foregroundStyle(HushColor.textPrimary)
            .padding(.vertical, HushSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

#if DEBUG
struct HushDemoRootView_Previews: PreviewProvider {
    static var previews: some View {
        HushDemoRootView()
            .frame(width: 420, height: 700)
    }
}
#endif
