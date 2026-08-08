import Combine
import Foundation
import SwiftUI
@preconcurrency import UserNotifications
#if canImport(UIKit)
import UIKit
#endif

extension Notification.Name {
    static let hushSleepHandoffRequested = Notification.Name(
        "hush.sleep-handoff-requested"
    )
}

@MainActor
final class HushSleepScheduleController: ObservableObject {
    static let shared = HushSleepScheduleController()
    nonisolated static let routeUserInfoKey = "hush_route"
    nonisolated static let sleepRouteValue = "sleep_handoff"

    @Published var isEnabled: Bool {
        didSet {
            defaults.set(isEnabled, forKey: Self.enabledKey)
            refreshSystemNotification()
            checkSchedule()
        }
    }

    @Published var sleepTime: Date {
        didSet {
            defaults.set(
                Self.minuteOfDay(for: sleepTime),
                forKey: Self.minuteOfDayKey
            )
            refreshSystemNotification()
            checkSchedule()
        }
    }

    private static let enabledKey = "sleep.schedule.enabled"
    private static let minuteOfDayKey = "sleep.schedule.minuteOfDay"
    private static let lastTriggeredDayKey =
        "sleep.schedule.lastTriggeredDay"
    private static let pendingRouteKey = "sleep.schedule.pendingRoute"
    nonisolated private static let notificationID =
        "hush.sleep-handoff.daily"

    private let defaults = UserDefaults.standard
    private var timer: AnyCancellable?

    private init() {
        isEnabled = defaults.bool(forKey: Self.enabledKey)
        let storedMinute = defaults.object(forKey: Self.minuteOfDayKey)
            as? Int ?? (23 * 60 + 30)
        sleepTime = Self.date(forMinuteOfDay: storedMinute)

        timer = Timer.publish(every: 20, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.checkSchedule()
            }
        refreshSystemNotification()
        checkSchedule()
    }

    func previewNow() {
        requestSleepHandoff()
    }

    func requestSleepHandoff() {
        defaults.set(true, forKey: Self.pendingRouteKey)
        NotificationCenter.default.post(
            name: .hushSleepHandoffRequested,
            object: nil
        )
    }

    func consumePendingRoute() -> Bool {
        let pending = defaults.bool(forKey: Self.pendingRouteKey)
        if pending {
            defaults.set(false, forKey: Self.pendingRouteKey)
        }
        return pending
    }

    private func checkSchedule(now: Date = Date()) {
        guard isEnabled else { return }

        let calendar = Calendar.current
        let nowComponents = calendar.dateComponents(
            [.hour, .minute],
            from: now
        )
        let currentMinute =
            (nowComponents.hour ?? 0) * 60 + (nowComponents.minute ?? 0)
        let targetMinute = Self.minuteOfDay(for: sleepTime)
        guard currentMinute >= targetMinute else { return }

        let day = Self.dayStamp(for: now)
        guard
            defaults.string(forKey: Self.lastTriggeredDayKey) != day
        else {
            return
        }

        defaults.set(day, forKey: Self.lastTriggeredDayKey)
        requestSleepHandoff()
    }

    private func refreshSystemNotification() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(
            withIdentifiers: [Self.notificationID]
        )
        guard isEnabled else { return }

        let calendar = Calendar.current
        let components = calendar.dateComponents(
            [.hour, .minute],
            from: sleepTime
        )
        let content = UNMutableNotificationContent()
        content.title = "该把今天轻轻放下了"
        content.body = "睡前交接已经准备好。"
        content.sound = .default
        content.userInfo = [
            Self.routeUserInfoKey: Self.sleepRouteValue
        ]
        let request = UNNotificationRequest(
            identifier: Self.notificationID,
            content: content,
            trigger: UNCalendarNotificationTrigger(
                dateMatching: components,
                repeats: true
            )
        )

        center.requestAuthorization(options: [.alert, .sound]) {
            granted,
            _ in
            guard granted else { return }
            UNUserNotificationCenter.current().add(request)
        }
    }

    private static func minuteOfDay(for date: Date) -> Int {
        let components = Calendar.current.dateComponents(
            [.hour, .minute],
            from: date
        )
        return (components.hour ?? 0) * 60 + (components.minute ?? 0)
    }

    private static func date(forMinuteOfDay minute: Int) -> Date {
        let calendar = Calendar.current
        return calendar.date(
            bySettingHour: minute / 60,
            minute: minute % 60,
            second: 0,
            of: Date()
        ) ?? Date()
    }

    private static func dayStamp(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = .current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

struct SleepHandoffView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var todaySummary: String
    @Binding var highlight: String
    @Binding var tomorrowFirstStep: String
    let onFinish: () -> Void

    @State private var step = 0
    @State private var isComplete = false
    @State private var visibleRecapCount = 0
    @State private var isRecapLeaving = false
    @State private var isClosingLineVisible = false
    @State private var isBedtimeTaskVisible = false
    // The page rests on the closing line + bedtime task; the 晚安 sign-off sits
    // in the lower-right corner, on the tide, and stays with them.
    @State private var isGoodnightVisible = false
    // Finger-following exit: the deliberate upward swipe, reversible below the
    // threshold, calm completion above it.
    @State private var exitProgress: CGFloat = 0
    @FocusState private var editorFocused: Bool

    private let prompts = [
        (
            title: "今天，什么向前走了一点？",
            hint: "完成了也好，只前进了一小步也好。",
            placeholder: "例如：把那个一直模糊的想法说清楚了一点……"
        ),
        (
            title: "今天，什么值得感谢？",
            hint: "可以是一个人、一件小事，或者某个很短的瞬间。",
            placeholder: "例如：有人认真听完了我想说的话……"
        ),
        (
            title: "明天，从哪一小步开始？",
            hint: "只留一个醒来后就能开始的小动作。",
            placeholder: "例如：先确认 Agent 的 HTTPS 地址……"
        )
    ]

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size

            ZStack {

                if isComplete {
                    completion(size: size)
                        .transition(.opacity)
                } else {
                    question
                        .id(step)
                        .transition(
                            .asymmetric(
                                insertion: .move(edge: .trailing)
                                    .combined(with: .opacity),
                                removal: .move(edge: .leading)
                                    .combined(with: .opacity)
                            )
                        )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // The whole page rides the exit swipe upward and fades, so the
            // gesture reads as lifting the night away rather than a page pop.
            .offset(y: -exitProgress * size.height * 0.42)
            .opacity(1 - Double(min(exitProgress * 1.25, 1)))
            .contentShape(Rectangle())
            .simultaneousGesture(exitGesture(in: size))
            .animation(.easeInOut(duration: 0.36), value: step)
            .animation(.easeInOut(duration: 0.5), value: isComplete)
        }
    }

    private var question: some View {
        ScrollView {
            questionBody
                .padding(.horizontal, 28)
                .padding(.top, HushSpacing.xl)
                .padding(.bottom, 120)
                .frame(maxWidth: 520, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    private var questionBody: some View {
        VStack(alignment: .leading, spacing: HushSpacing.xl) {
            VStack(alignment: .leading, spacing: HushSpacing.sm) {
                HStack(spacing: 7) {
                    ForEach(0..<prompts.count, id: \.self) { index in
                        Capsule()
                            .fill(
                                Color.white.opacity(index == step ? 0.72 : 0.14)
                            )
                            .frame(width: index == step ? 22 : 7, height: 4)
                            .animation(
                                .easeInOut(duration: 0.35),
                                value: step
                            )
                    }
                }
                .padding(.bottom, HushSpacing.sm)

                Text(prompts[step].title)
                    .font(.system(size: 31, weight: .medium, design: .rounded))
                    .foregroundStyle(HushColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                Text(prompts[step].hint)
                    .font(HushType.body)
                    .lineSpacing(5)
                    .foregroundStyle(HushColor.textSecondary)
            }

            ZStack(alignment: .topLeading) {
                if activeText.wrappedValue.isEmpty {
                    Text(prompts[step].placeholder)
                        .font(HushType.body)
                        .foregroundStyle(Color.white.opacity(0.25))
                        .padding(.horizontal, HushSpacing.md + 4)
                        .padding(.vertical, HushSpacing.md + 8)
                        .allowsHitTesting(false)
                }

                TextEditor(text: activeText)
                    .font(HushType.body)
                    .lineSpacing(5)
                    .foregroundStyle(HushColor.textPrimary)
                    .scrollContentBackground(.hidden)
                    .focused($editorFocused)
                    .frame(minHeight: 156)
                    .padding(HushSpacing.md)
            }
            .background(
                RoundedRectangle(
                    cornerRadius: HushRadius.large,
                    style: .continuous
                )
                .fill(Color.white.opacity(0.035))
            )
            .overlay(
                RoundedRectangle(
                    cornerRadius: HushRadius.large,
                    style: .continuous
                )
                .stroke(Color.white.opacity(0.08), lineWidth: 0.8)
            )

            HStack {
                if step > 0 {
                    Button {
                        step -= 1
                    } label: {
                        Image(systemName: "chevron.left")
                            .frame(width: 38, height: 38)
                            .background(
                                Circle().fill(Color.white.opacity(0.055))
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("上一步")
                }

                Spacer()

                Button {
                    advance()
                } label: {
                    HStack(spacing: HushSpacing.xs) {
                        Text(step == prompts.count - 1 ? "轻轻放下" : "下一句")
                        Image(
                            systemName: step == prompts.count - 1
                                ? "moon.stars"
                                : "arrow.right"
                        )
                    }
                    .font(HushType.bodyStrong)
                    .foregroundStyle(Color.white.opacity(0.86))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 11)
                    .background(Color.white.opacity(0.075), in: Capsule())
                    .overlay(
                        Capsule().stroke(
                            Color.white.opacity(0.10),
                            lineWidth: 0.8
                        )
                    )
                }
                .buttonStyle(.plain)
                .disabled(
                    activeText.wrappedValue
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .isEmpty
                )
                .opacity(
                    activeText.wrappedValue
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .isEmpty
                        ? 0.36
                        : 1
                )

                Button("跳过") {
                    activeText.wrappedValue = ""
                    advance()
                }
                .buttonStyle(.plain)
                .font(HushType.caption)
                .foregroundStyle(Color.white.opacity(0.42))
            }
        }
    }

    private func completion(size: CGSize) -> some View {
        ZStack {
            // Night background covering the idle line composition behind us.
            Color.black.ignoresSafeArea()

            // The supplied layered watercolour tide, raised as high as it can go
            // while its crest still clears the reading text above it.
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                SleepLayeredTide(reduceMotion: reduceMotion)
                    .frame(height: size.height * 1.02)
            }
            .ignoresSafeArea()

            // 1) Cinematic recap — appears one by one, then drifts up and fades.
            //    (Reduce Motion drops the travel and uses opacity only.)
            cinematicRecap
                .padding(.horizontal, 30)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .offset(y: reduceMotion ? 0 : (isRecapLeaving ? -size.height * 0.24 : 0))
                .opacity(isRecapLeaving ? 0 : 1)

            // 2) Closing line + bedtime task — appear and STAY: this is where the
            //    page comes to rest.
            VStack(alignment: .leading, spacing: 30) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(closingLine)
                        .font(.system(size: 30, weight: .medium, design: .rounded))
                        .lineSpacing(5)
                        .foregroundStyle(Color.white.opacity(0.92))
                        .opacity(isClosingLineVisible ? 1 : 0)
                        .offset(y: reduceMotion ? 0 : (isClosingLineVisible ? 0 : 18))

                    bedtimeTask
                        .opacity(isBedtimeTaskVisible ? 1 : 0)
                        .offset(y: reduceMotion ? 0 : (isBedtimeTaskVisible ? 0 : 22))
                }
            }
            .padding(.horizontal, 30)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.top, size.height * 0.15)

            // 3) Sign-off — bottom-right corner, sitting on the tide, bold, and
            //    staying alongside the resting task. Not a button.
            goodnight
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .padding(.trailing, 26)
                .padding(.bottom, size.height * 0.055)
                .opacity(isGoodnightVisible ? 1 : 0)
                .offset(y: reduceMotion ? 0 : (isGoodnightVisible ? 0 : 14))
        }
        .task {
            await runCompletionSequence()
        }
        .animation(.easeOut(duration: 0.85), value: isClosingLineVisible)
        .animation(.easeOut(duration: 0.85), value: isBedtimeTaskVisible)
        .animation(.easeInOut(duration: 1.35), value: isRecapLeaving)
        .animation(.easeOut(duration: 1.1), value: isGoodnightVisible)
    }

    private var cinematicRecap: some View {
        VStack(alignment: .leading, spacing: 32) {
            ForEach(
                Array(recapEntries.enumerated()),
                id: \.offset
            ) { index, entry in
                VStack(alignment: .leading, spacing: 8) {
                    // Question is secondary; the kept answer is primary.
                    if !entry.question.isEmpty {
                        Text(entry.question)
                            .font(HushType.caption)
                            .foregroundStyle(Color.white.opacity(0.32))
                    }

                    Text(entry.answer)
                        .font(.system(size: 23, weight: .regular, design: .rounded))
                        .lineSpacing(6)
                        .foregroundStyle(Color.white.opacity(0.86))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .opacity(visibleRecapCount > index ? 1 : 0)
                .offset(y: visibleRecapCount > index ? 0 : 18)
                .animation(.easeOut(duration: 0.75), value: visibleRecapCount)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var goodnight: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("晚安")
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .foregroundStyle(Color.white)

            Text("😴")
                .font(.system(size: 30))
        }
        // Sits on the watercolour waves, so a soft shadow keeps it legible over
        // the lighter ivory areas.
        .shadow(color: .black.opacity(0.55), radius: 10, y: 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("晚安")
    }

    private var bedtimeTask: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("睡前，做一件很小的事")
                .font(HushType.caption)
                .foregroundStyle(Color.white.opacity(0.42))

            sleepTip("把手机放到伸手够不到一点的位置", "iphone.slash")
            sleepTip("喝一小口水，不再处理新的事情", "drop")
            sleepTip("让房间的光再暗一点", "lightbulb.min")
        }
        .padding(.top, 2)
    }

    private var recapEntries: [(question: String, answer: String)] {
        let candidates = [
            (prompts[0].title, todaySummary),
            (prompts[1].title, highlight),
            (prompts[2].title, tomorrowFirstStep)
        ]
        let entries = candidates.compactMap { question, answer in
            let trimmed = answer.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            return trimmed.isEmpty
                ? nil
                : (question: question, answer: trimmed)
        }
        if entries.isEmpty {
            // Nothing was kept — one quiet fallback line, on its own.
            return [
                (question: "", answer: "今晚，没有什么一定要写下来。")
            ]
        }
        return entries
    }

    private var closingLine: String {
        if hasTomorrowFirstStep {
            return "剩下的，交给明天醒来的你。"
        }
        if hasTodayReflection {
            return "把今天轻轻放在这里吧。"
        }
        return "Put your mind to bed."
    }

    private var activeText: Binding<String> {
        switch step {
        case 0:
            return $todaySummary
        case 1:
            return $highlight
        default:
            return $tomorrowFirstStep
        }
    }

    private var hasHighlight: Bool {
        !highlight.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var hasTodayReflection: Bool {
        !todaySummary.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).isEmpty || hasHighlight
    }

    private var hasTomorrowFirstStep: Bool {
        !tomorrowFirstStep.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).isEmpty
    }

    private func advance() {
        if step < prompts.count - 1 {
            step += 1
        } else {
            isComplete = true
        }
    }

    // MARK: - Deliberate upward-swipe exit

    /// Finger-following exit, in the character of the Work page: progress tracks
    /// the drag, is reversible below the threshold, and completes calmly above
    /// it. It only begins from the lower region and only for a predominantly
    /// upward drag, so ordinary text scrolling or editing never dismisses.
    private func exitGesture(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 16)
            .onChanged { value in
                guard isExitEligible(value, in: size) else { return }
                dismissKeyboard()
                let rise = -value.translation.height
                exitProgress = min(1, max(0, rise / (size.height * 0.55)))
            }
            .onEnded { value in
                guard isExitEligible(value, in: size) else {
                    if exitProgress > 0 {
                        withAnimation(.easeOut(duration: 0.7)) { exitProgress = 0 }
                    }
                    return
                }
                let threshold = size.height * 0.25
                if -value.translation.height >= threshold {
                    // Above threshold: complete slowly and calmly, then hand back
                    // to the existing finish/route-clearing behaviour.
                    withAnimation(
                        .timingCurve(0.26, 0.03, 0.2, 1, duration: 1.35)
                    ) {
                        exitProgress = 1
                    }
                    Task { @MainActor in
                        try? await Task.sleep(nanoseconds: 1_320_000_000)
                        onFinish()
                    }
                } else {
                    // Below threshold: settle softly back, no bounce.
                    withAnimation(.easeOut(duration: 0.7)) { exitProgress = 0 }
                }
            }
    }

    private func isExitEligible(
        _ value: DragGesture.Value,
        in size: CGSize
    ) -> Bool {
        value.startLocation.y > size.height * 0.6
            && value.translation.height < 0
            && abs(value.translation.height) > abs(value.translation.width) * 1.3
    }

    private func dismissKeyboard() {
        editorFocused = false
        #if os(iOS)
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder),
            to: nil,
            from: nil,
            for: nil
        )
        #endif
    }

    @MainActor
    private func runCompletionSequence() async {
        visibleRecapCount = 0
        isRecapLeaving = false
        isClosingLineVisible = false
        isBedtimeTaskVisible = false
        isGoodnightVisible = false

        if reduceMotion {
            // Simple opacity crossfades, no travel, brief waits — the content is
            // shown, not performed, and the user is never held by a long play.
            visibleRecapCount = recapEntries.count
            guard await wait(milliseconds: 1_000) else { return }
            isRecapLeaving = true
            isClosingLineVisible = true
            isBedtimeTaskVisible = true
            isGoodnightVisible = true
            return
        }

        // Kept answers fade in one by one, like film-ending credits.
        for count in 1...recapEntries.count {
            guard await wait(milliseconds: count == 1 ? 500 : 720) else { return }
            visibleRecapCount = count
        }

        // Read the group, then it drifts upward and fades.
        guard await wait(milliseconds: 1_100) else { return }
        isRecapLeaving = true

        // Closing line, then the very small bedtime task — the page's resting
        // state.
        guard await wait(milliseconds: 1_350) else { return }
        isClosingLineVisible = true
        guard await wait(milliseconds: 900) else { return }
        isBedtimeTaskVisible = true

        // The 晚安 sign-off settles into the lower-right corner and stays; there
        // is no separate page, and no automatic exit.
        guard await wait(milliseconds: 800) else { return }
        isGoodnightVisible = true
    }

    private func sleepTip(
        _ text: String,
        _ systemImage: String
    ) -> some View {
        Label(text, systemImage: systemImage)
            .font(HushType.body)
            .foregroundStyle(Color.white.opacity(0.64))
    }

    private func wait(milliseconds: Int) async -> Bool {
        do {
            try await Task.sleep(
                nanoseconds: UInt64(milliseconds) * 1_000_000
            )
            return !Task.isCancelled
        } catch {
            return false
        }
    }
}

/// The supplied layered watercolour tide, kept intact.
///
/// The exact bitmap is aspect-filled and slightly overscanned; nothing is
/// traced, recoloured or redrawn. The safe fallback motion from the brief is
/// used — the whole intact plate drifts slowly left/right with a tiny damped
/// vertical bob on a long ~16 s cycle, and the overscan means an edge is never
/// exposed. Reduce Motion shows the exact static crop.
private struct SleepLayeredTide: View {
    let reduceMotion: Bool

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            // Overscan so the slow drift never uncovers an empty edge.
            let plateWidth = size.width + 96
            let plateHeight = size.height + 60

            TimelineView(
                .animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)
            ) { timeline in
                let elapsed = reduceMotion
                    ? 0
                    : timeline.date.timeIntervalSinceReferenceDate
                // Long, soft, incommensurate cycles: horizontal ~16 s, vertical
                // ~22 s, so the loop never reads as a mechanical repeat.
                let dx = reduceMotion
                    ? 0
                    : CGFloat(sin(elapsed * (2 * .pi / 16.0))) * 12
                let dy = reduceMotion
                    ? 0
                    : CGFloat(sin(elapsed * (2 * .pi / 22.0) + 1.3)) * 7

                sleepTideImage
                    .resizable()
                    .interpolation(.high)
                    .antialiased(true)
                    .aspectRatio(contentMode: .fill)
                    .frame(width: plateWidth, height: plateHeight)
                    .offset(x: dx, y: dy)
                    .frame(width: size.width, height: size.height, alignment: .bottom)
                    .clipped()
            }
        }
        .accessibilityHidden(true)
    }

    private var sleepTideImage: Image {
        guard
            let url = Bundle.main.url(
                forResource: "hush-sleep-tide",
                withExtension: "png"
            )
        else {
            return Image(systemName: "moon.stars")
        }
        #if os(macOS)
        return NSImage(contentsOf: url).map(Image.init(nsImage:))
            ?? Image(systemName: "moon.stars")
        #else
        return UIImage(contentsOfFile: url.path).map(Image.init(uiImage:))
            ?? Image(systemName: "moon.stars")
        #endif
    }
}

struct HandoffRunningView: View {
    let onShowResult: () -> Void

    private let stages = [
        ("读取已授权范围", "checkmark.circle.fill"),
        ("整理明天事项", "checkmark.circle.fill"),
        ("准备草稿建议", "ellipsis.circle.fill"),
        ("生成 Pause Receipt", "circle")
    ]

    var body: some View {
        VStack(spacing: HushSpacing.xl) {
            Spacer(minLength: HushSpacing.lg)

            ZStack {
                Circle()
                    .stroke(Color.white.opacity(0.08), lineWidth: 8)
                    .frame(width: 112, height: 112)
                Circle()
                    .trim(from: 0, to: 0.68)
                    .stroke(
                        AngularGradient(colors: [HushColor.cyan, HushColor.violet], center: .center),
                        style: StrokeStyle(lineWidth: 8, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .frame(width: 112, height: 112)
                Text("35s")
                    .font(.system(size: 26, weight: .medium, design: .rounded))
                    .foregroundStyle(HushColor.textPrimary)
            }
            .accessibilityLabel("预计还需 35 秒")

            VStack(spacing: HushSpacing.xs) {
                Text("正在替你把边界说清楚")
                    .font(HushType.title)
                    .foregroundStyle(HushColor.textPrimary)
                Text("你可以先不管它。")
                    .font(HushType.body)
                    .foregroundStyle(HushColor.textSecondary)
            }

            VStack(alignment: .leading, spacing: HushSpacing.md) {
                ForEach(Array(stages.enumerated()), id: \.offset) { index, stage in
                    HStack(spacing: HushSpacing.sm) {
                        Image(systemName: stage.1)
                            .foregroundStyle(index < 2 ? HushColor.mint : (index == 2 ? HushColor.cyan : HushColor.textSecondary))
                        Text(stage.0)
                            .font(HushType.body)
                            .foregroundStyle(index <= 2 ? HushColor.textPrimary : HushColor.textSecondary)
                        Spacer()
                    }
                }
            }
            .hushPanel()

            Button(action: onShowResult) {
                Text("查看交接结果")
            }
            .buttonStyle(HushPrimaryButtonStyle())

            Spacer(minLength: HushSpacing.lg)
        }
    }
}
