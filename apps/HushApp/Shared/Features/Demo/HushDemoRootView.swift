import SwiftUI

struct HushDemoRootView: View {
    @StateObject private var store: HushDemoStore
    @ObservedObject private var sleepSchedule =
        HushSleepScheduleController.shared
    @State private var isShowingSettings = false
    @State private var inboxRevealProgress: CGFloat = 0
    @State private var isRevealingInbox = false
    // The tide-revealed inbox stays mounted for the whole gesture, so `progress`
    // can drive its reveal continuously instead of the view being inserted or
    // removed mid-animation. Cleared only once a cancelled swipe has fully
    // receded, or handed straight to the `.inbox` route on completion.
    @State private var isSwipingInbox = false
    private let onSettings: (() -> Void)?
    private let onCompanion: (() -> Void)?
    private let suggestedQuestID: String?
    private let suggestionMessage: String?
    private let suggestionEventID: String?

    @MainActor
    init(
        provider: any HushRestContentProviding = BundledHushRestContentProvider.automatic,
        initialQuestID: String? = nil,
        onSettings: (() -> Void)? = nil,
        onCompanion: (() -> Void)? = nil,
        suggestedQuestID: String? = nil,
        suggestionMessage: String? = nil,
        suggestionEventID: String? = nil
    ) {
        self.onSettings = onSettings
        self.onCompanion = onCompanion
        self.suggestedQuestID = suggestedQuestID
        self.suggestionMessage = suggestionMessage
        self.suggestionEventID = suggestionEventID
        _store = StateObject(
            wrappedValue: HushDemoStore(
                provider: provider,
                initialQuestID: initialQuestID ?? suggestedQuestID
            )
        )
    }

    var body: some View {
        ZStack {
            HushWaveBackground(revealProgress: inboxRevealProgress)

            if store.route == .door {
                HushDoorView(
                    taskText: agentTaskText,
                    onOpenTask: store.openCurrentQuest,
                    onSettings: {
                        if let onSettings {
                            onSettings()
                        } else {
                            isShowingSettings = true
                        }
                    },
                    onInboxSwipeChanged: updateInboxSwipe,
                    onInboxSwipeEnded: finishInboxSwipe,
                    onOpenCompanion: onCompanion
                )
                .opacity(
                    1 - min(inboxRevealProgress * 1.65, 1)
                )
                .allowsHitTesting(!isRevealingInbox)
                .transition(.opacity)
            } else if store.route == .inbox {
                // The inbox is drawn by the shared tide layer below, so the same
                // view and store carry unbroken from the transition into the
                // interactive route — no second instance to fade in over it.
                EmptyView()
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

            // One continuous inbox, brought out by the tide. It is present for
            // the whole swipe (`isSwipingInbox`) and stays for the `.inbox`
            // route, so `inboxRevealProgress` — the same driver as the wave —
            // reveals its surface and rows in lock-step with the rising water.
            // Once routed it reads a constant 1 (fully settled, interactive).
            if store.route == .inbox || isSwipingInbox || isRevealingInbox {
                UnifiedInboxView(
                    onClose: store.closeInbox,
                    revealProgress: store.route == .inbox ? 1 : inboxRevealProgress
                )
                .allowsHitTesting(store.route == .inbox)
                .transition(.opacity)
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
            store.presentRestSuggestion(questID: suggestedQuestID)
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

    private var agentTaskText: String {
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

        return taskText(for: store.currentQuest)
    }

    private func taskText(for quest: HushQuestContent) -> String {
        let steps = quest.steps.prefix(2)
        let task = (steps.isEmpty ? quest.title : steps.joined(separator: "\n"))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !task.isEmpty else {
            return "先休息一下。"
        }
        return task.hasSuffix("。") ? task : "\(task)。"
    }

    /// While the finger is down, the whole choreography — water, page, messages
    /// — tracks the swipe distance directly (no animation, so it follows the
    /// finger frame-for-frame). Mounting the inbox on the first movement lets it
    /// begin surfacing as the water rises, rather than after the swipe ends.
    private func updateInboxSwipe(_ progress: CGFloat) {
        guard !isRevealingInbox else { return }

        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            isSwipingInbox = true
            inboxRevealProgress = min(0.96, max(0, progress))
        }
    }

    private func finishInboxSwipe(_ shouldComplete: Bool) {
        guard !isRevealingInbox else { return }

        // Cancelled: the water falls back and the surfacing messages recede with
        // it, continuing from wherever the finger let go — never a jump-cut back
        // to frame zero. Faster the less there is to undo.
        guard shouldComplete else {
            let duration = 0.34 + Double(inboxRevealProgress) * 0.55
            withAnimation(
                .timingCurve(0.22, 0.72, 0.28, 1, duration: duration)
            ) {
                inboxRevealProgress = 0
            } completion: {
                isSwipingInbox = false
            }
            return
        }

        // Committed: continue from the current progress to the end. Duration
        // scales with the distance left so a late release settles quickly and an
        // early flick still gets a full, unhurried tide — the gesture's own
        // reach standing in for its velocity, then easing out.
        isRevealingInbox = true
        let remaining = max(0, 1 - inboxRevealProgress)
        let duration = 0.45 + Double(remaining) * 0.95
        withAnimation(
            .timingCurve(0.26, 0.03, 0.12, 1, duration: duration)
        ) {
            inboxRevealProgress = 1
        } completion: {
            // The reveal already shows the fully-settled inbox, so switching to
            // the interactive route is a same-frame, animation-free swap: no
            // fade, no page appearing "after" the tide. Progress resets to 0 for
            // next time; the routed inbox reads a constant 1 and stays opaque,
            // hiding the wave view as it rewinds behind it.
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                store.route = .inbox
                inboxRevealProgress = 0
                isRevealingInbox = false
                isSwipingInbox = false
            }
        }
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
                canSwap: store.content.quests.count > 1,
                onSwap: store.swapQuest,
                onStart: store.startSession
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
