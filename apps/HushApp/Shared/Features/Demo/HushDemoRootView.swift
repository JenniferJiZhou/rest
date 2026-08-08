import SwiftUI


struct HushDemoRootView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var store: HushDemoStore
    @ObservedObject private var sleepSchedule =
        HushSleepScheduleController.shared
    @State private var isShowingSettings = false
    // The breath session is always opt-in: a long press on the water offers it,
    // and only an explicit "开始" starts it.
    @State private var isOfferingBreath = false
    @State private var isBreathing = false
    // Tide transition state machine. The swipe only *triggers* it; once armed it
    // runs off its own clock and ignores the finger entirely.
    //   • `isRevealingInbox` == true  → `tideTransitioning` (auto animation)
    //   • `tideStartedAt`             → the clock origin the whole timeline reads
    // Absent both, we are `idle` (route == .door) or `messagesVisible`
    // (route == .inbox).
    @State private var isRevealingInbox = false
    @State private var tideStartedAt: Date?
    @State private var tideTask: Task<Void, Never>?
    // Sleep entry reuses the very same main-page ocean: it rises and covers the
    // door, and only under that cover do we switch to the Sleep Handoff route.
    @State private var isCoveringForSleep = false
    @State private var sleepCoverTask: Task<Void, Never>?
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
        // One clock for the whole transition. It ticks only while the tide is
        // playing (`paused` otherwise, so idle costs nothing here — the wave's
        // own line-lull keeps its separate ticker). Everything below reads a
        // single elapsed value, so the water, the surface and the messages are
        // three views of the same instant and can never desync.
        TimelineView(
            .animation(
                minimumInterval: 1.0 / 60.0,
                paused: !(isRevealingInbox || isCoveringForSleep)
            )
        ) { timeline in
            let elapsed = tideStartedAt.map {
                timeline.date.timeIntervalSince($0)
            } ?? 0
            let waterProgress = (isRevealingInbox || isCoveringForSleep)
                ? HushTideTimeline.tideProgress(elapsed: elapsed)
                : 0

            ZStack {
                HushWaveBackground(revealProgress: waterProgress)

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
                        onInboxSwipeTriggered: startInboxTide,
                        onOpenCompanion: onCompanion,
                        onBreathLongPress: offerBreath
                    )
                    .opacity(1 - min(waterProgress * 1.65, 1))
                    .allowsHitTesting(!isRevealingInbox && !isCoveringForSleep)
                    .transition(.opacity)
                } else if store.route == .inbox {
                    // Drawn by the shared tide layer below, so the same view and
                    // store carry unbroken from the transition into the route.
                    EmptyView()
                } else if store.route == .sleepHandoff {
                    // Nighttime mode: full screen, no demo/navigation chrome. It
                    // owns its own layout and safe areas, and is left only by the
                    // deliberate upward swipe.
                    SleepHandoffView(
                        todaySummary: $store.sleepTodaySummary,
                        highlight: $store.sleepHighlight,
                        tomorrowFirstStep: $store.sleepTomorrowFirstStep,
                        onFinish: store.finishSleepHandoff
                    )
                    .transition(.opacity)
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
                    .transition(.opacity)
                }

                // One continuous inbox, brought out by the tide. Present for the
                // whole auto transition and kept for the `.inbox` route, so the
                // same view and store carry across the hand-off. During the tide
                // it reads the clock (water progress + elapsed seconds); once
                // routed it is `.settled` — fully revealed and interactive.
                if store.route == .inbox || isRevealingInbox {
                    UnifiedInboxView(
                        onClose: store.closeInbox,
                        reveal: store.route == .inbox
                            ? .settled
                            : HushTideReveal(
                                progress: waterProgress,
                                elapsed: elapsed
                            )
                    )
                    .allowsHitTesting(store.route == .inbox)
                    .transition(.opacity)
                }
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
                startSleepEntry()
            }
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: .hushSleepHandoffRequested
            )
        ) { _ in
            startSleepEntry()
        }
        .onChange(of: suggestionEventID) { _, _ in
            store.presentRestSuggestion(questID: suggestedQuestID)
        }
        .onDisappear {
            tideTask?.cancel()
            sleepCoverTask?.cancel()
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

    /// Offer the breath, but never over a transition that is already running:
    /// the door hands the screen to the tide, and two tides at once would fight.
    private func offerBreath() {
        guard !isRevealingInbox, !isCoveringForSleep, !isBreathing else { return }
        isOfferingBreath = true
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

    /// A single upward swipe past the door's small threshold lands here and
    /// starts the whole tide — once. From this point the finger is irrelevant:
    /// the clock is set, the `TimelineView` unpauses, and the water, surface and
    /// messages all play off `tideStartedAt` on their fixed timeline. It cannot
    /// be re-triggered, reversed by a finger retreat, or cancelled by an early
    /// release — the guard and the state machine see to that.
    private func startInboxTide() {
        guard store.route == .door, !isRevealingInbox else { return }

        tideTask?.cancel()
        isRevealingInbox = true
        tideStartedAt = Date()

        // The transition is a fixed length with no cancel path, so a plain sleep
        // is the whole "completion criteria": when the clock runs out the fully
        // revealed inbox is already on screen, and we swap to the interactive
        // route in one animation-free frame (identical pixels → seamless). The
        // wave view resets behind the now-opaque surface.
        tideTask = Task { @MainActor in
            try? await Task.sleep(
                nanoseconds: UInt64(HushTideTimeline.tideDuration * 1_000_000_000)
            )
            guard !Task.isCancelled else { return }

            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                store.route = .inbox
                isRevealingInbox = false
                tideStartedAt = nil
            }
        }
    }

    /// A sleep notification / schedule brings the app to the main page, then the
    /// existing main-page ocean rises and covers it; only under that opaque
    /// cover do we switch to the Sleep Handoff route and let the ocean recede,
    /// revealing the night without a flash. Guarded so repeated notifications
    /// never start overlapping transitions. Reduce Motion takes a short
    /// crossfade instead of the full rise.
    private func startSleepEntry() {
        guard !isCoveringForSleep,
              !isRevealingInbox,
              store.route != .sleepHandoff else { return }

        // Come back to the main/door page first, so the ocean rises from it.
        if store.route != .door {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { store.route = .door }
        }

        if reduceMotion {
            withAnimation(.easeInOut(duration: 0.4)) {
                store.route = .sleepHandoff
            }
            return
        }

        sleepCoverTask?.cancel()
        isCoveringForSleep = true
        tideStartedAt = Date()

        let cover = HushTideTimeline.tideDuration
        sleepCoverTask = Task { @MainActor in
            try? await Task.sleep(
                nanoseconds: UInt64(cover * 1_000_000_000)
            )
            guard !Task.isCancelled else { return }

            // Fully covered: fade the night in over the opaque ocean…
            withAnimation(.easeInOut(duration: 0.55)) {
                store.route = .sleepHandoff
            }
            try? await Task.sleep(nanoseconds: 560_000_000)
            guard !Task.isCancelled else { return }

            // …then reset the ocean behind the now-covering Sleep Handoff.
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                isCoveringForSleep = false
                tideStartedAt = nil
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
            // Rendered full-screen by its own route branch above.
            EmptyView()
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
