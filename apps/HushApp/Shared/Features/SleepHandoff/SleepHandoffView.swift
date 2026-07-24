import Combine
import Foundation
import SwiftUI
@preconcurrency import UserNotifications

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
        content.title = "今晚先到这里"
        content.body = "睡前交接已经准备好了。"
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
    @Binding var todaySummary: String
    @Binding var highlight: String
    @Binding var tomorrowFirstStep: String
    let onFinish: () -> Void

    @State private var step = 0
    @State private var isComplete = false
    @State private var completionStage = 0

    private let prompts = [
        (
            eyebrow: "今天",
            title: "今天发生了什么？",
            hint: "不用完整，只写下现在还记得的部分。",
            placeholder: "例如：把演示流程走通了，也和大家确认了下一步……"
        ),
        (
            eyebrow: "留下",
            title: "哪一件事最重要？",
            hint: "可以是一件完成的事，也可以是一个不想忘记的瞬间。",
            placeholder: "例如：终于把那个一直模糊的想法说清楚了……"
        ),
        (
            eyebrow: "明天",
            title: "明天醒来，先做什么？",
            hint: "只留一个足够小的起点，其他事情今晚不用继续记着。",
            placeholder: "例如：先确认 Agent 的 HTTPS 地址……"
        )
    ]

    var body: some View {
        ZStack {
            RadialGradient(
                colors: [
                    Color(red: 0.16, green: 0.13, blue: 0.25).opacity(0.32),
                    Color.clear
                ],
                center: .topTrailing,
                startRadius: 10,
                endRadius: 420
            )
            .allowsHitTesting(false)

            if isComplete {
                completion
                    .transition(.opacity.combined(with: .scale(scale: 0.985)))
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
        .animation(.easeInOut(duration: 0.36), value: step)
        .animation(.easeInOut(duration: 0.5), value: isComplete)
    }

    private var question: some View {
        VStack(alignment: .leading, spacing: HushSpacing.xl) {
            VStack(alignment: .leading, spacing: HushSpacing.sm) {
                HStack(spacing: HushSpacing.xs) {
                    Image(systemName: "moon.fill")
                    Text("SLEEP HANDOFF · \(step + 1) / \(prompts.count)")
                }
                .font(HushType.eyebrow)
                .tracking(1.1)
                .foregroundStyle(Color.white.opacity(0.42))

                Text(prompts[step].eyebrow)
                    .font(HushType.caption)
                    .foregroundStyle(Color.white.opacity(0.46))

                Text(prompts[step].title)
                    .font(.system(size: 29, weight: .medium, design: .rounded))
                    .foregroundStyle(HushColor.textPrimary)

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

            Text("演示模式 · 内容只保留在当前页面，退出后清除。")
                .font(HushType.micro)
                .foregroundStyle(Color.white.opacity(0.30))
        }
    }

    private var completion: some View {
        VStack(alignment: .leading, spacing: HushSpacing.xl) {
            SleepClosingBadge()

            Text(completionSubtitle)
                .font(HushType.body)
                .lineSpacing(5)
                .foregroundStyle(HushColor.textSecondary)
                .opacity(completionStage >= 1 ? 1 : 0)

            SleepTideView()
                .frame(height: 104)
                .opacity(completionStage >= 1 ? 1 : 0)
                .offset(y: completionStage >= 1 ? 0 : 44)

            if hasHighlight || hasTomorrowFirstStep {
                VStack(alignment: .leading, spacing: HushSpacing.lg) {
                    if hasHighlight {
                        VStack(
                            alignment: .leading,
                            spacing: HushSpacing.xs
                        ) {
                            HushSectionLabel(text: "今天留下")
                            Text(highlight)
                                .font(HushType.body)
                                .lineLimit(3)
                                .foregroundStyle(Color.white.opacity(0.70))
                        }
                    }

                    if hasTomorrowFirstStep {
                        VStack(
                            alignment: .leading,
                            spacing: HushSpacing.xs
                        ) {
                            HushSectionLabel(text: "明天先做")
                            Text(tomorrowFirstStep)
                                .font(HushType.bodyStrong)
                                .foregroundStyle(HushColor.textPrimary)
                        }
                    }
                }
                .padding(HushSpacing.lg)
                .background(
                    Color.white.opacity(0.045),
                    in: RoundedRectangle(
                        cornerRadius: HushRadius.large,
                        style: .continuous
                    )
                )
                .opacity(completionStage >= 2 ? 1 : 0)
                .offset(y: completionStage >= 2 ? 0 : 22)
            }

            VStack(alignment: .leading, spacing: HushSpacing.lg) {
                HushSectionLabel(text: "睡前可以做")
                sleepTip(
                    "把手机放到伸手够不到一点的位置",
                    "iphone.slash",
                    stage: 3
                )
                sleepTip(
                    "喝一小口水，不用再处理新的事情",
                    "drop",
                    stage: 4
                )
                sleepTip(
                    "让房间的光再暗一点",
                    "lightbulb.min",
                    stage: 5
                )
            }
            .opacity(completionStage >= 3 ? 1 : 0)

            Button(action: onFinish) {
                Text("今晚先到这里")
                    .font(HushType.bodyStrong)
                    .foregroundStyle(Color.white.opacity(0.82))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Color.white.opacity(0.07), in: Capsule())
            }
            .buttonStyle(.plain)
            .opacity(completionStage >= 6 ? 1 : 0)
        }
        .task {
            await runCompletionSequence()
        }
        .animation(
            .easeOut(duration: 0.75),
            value: completionStage
        )
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

    private var hasTomorrowFirstStep: Bool {
        !tomorrowFirstStep.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).isEmpty
    }

    private var completionSubtitle: String {
        if hasTomorrowFirstStep {
            return "明天的第一步已经放在这里，今晚不用继续记着。"
        }
        if hasHighlight {
            return "今天值得留下的部分已经在这里了。"
        }
        return "今晚不需要留下任何文字，也可以安心停在这里。"
    }

    private func advance() {
        if step < prompts.count - 1 {
            step += 1
        } else {
            isComplete = true
        }
    }

    @MainActor
    private func runCompletionSequence() async {
        completionStage = 0
        for stage in 1...6 {
            do {
                try await Task.sleep(nanoseconds: 430_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            completionStage = stage
        }
    }

    private func sleepTip(
        _ text: String,
        _ systemImage: String,
        stage: Int
    ) -> some View {
        Label(text, systemImage: systemImage)
            .font(HushType.body)
            .foregroundStyle(Color.white.opacity(0.64))
            .opacity(completionStage >= stage ? 1 : 0)
            .offset(y: completionStage >= stage ? 0 : 12)
    }
}

private struct SleepClosingBadge: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    var body: some View {
        HStack(spacing: HushSpacing.sm) {
            Image(systemName: "moon.stars.fill")
                .font(.system(size: 18, weight: .light))
            Text("今晚先到这里")
                .font(.system(size: 24, weight: .medium, design: .rounded))
        }
        .foregroundStyle(Color.white.opacity(0.90))
        .padding(.horizontal, 22)
        .padding(.vertical, 15)
        .background(
            Capsule()
                .fill(Color(red: 0.16, green: 0.13, blue: 0.24).opacity(0.72))
        )
        .overlay(
            Capsule()
                .stroke(Color.white.opacity(0.14), lineWidth: 0.8)
        )
        .shadow(
            color: Color(
                red: 0.48,
                green: 0.40,
                blue: 0.78
            )
            .opacity(breathing ? 0.42 : 0.16),
            radius: breathing ? 26 : 10
        )
        .scaleEffect(breathing ? 1.012 : 0.994)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(
                .easeInOut(duration: 3.4)
                    .repeatForever(autoreverses: true)
            ) {
                breathing = true
            }
        }
        .accessibilityAddTraits(.isHeader)
    }
}

private struct SleepTideView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(
            .animation(
                minimumInterval: 1.0 / 30.0,
                paused: reduceMotion
            )
        ) { timeline in
            Canvas { context, size in
                let elapsed = reduceMotion
                    ? 0
                    : timeline.date.timeIntervalSinceReferenceDate
                for layer in 0..<3 {
                    let progress = Double(layer) / 2
                    let phase = elapsed * (0.22 + progress * 0.05)
                    let path = tidePath(
                        size: size,
                        baseline: size.height * (0.52 + progress * 0.13),
                        amplitude: 9 + progress * 5,
                        phase: phase + progress * 1.7
                    )
                    context.stroke(
                        path,
                        with: .color(
                            Color(
                                red: 0.57,
                                green: 0.51,
                                blue: 0.82
                            )
                            .opacity(0.34 - progress * 0.08)
                        ),
                        style: StrokeStyle(
                            lineWidth: 1.2,
                            lineCap: .round
                        )
                    )
                }
            }
        }
        .accessibilityHidden(true)
    }

    private func tidePath(
        size: CGSize,
        baseline: CGFloat,
        amplitude: CGFloat,
        phase: Double
    ) -> Path {
        var path = Path()
        let step = max(1, size.width / 240)

        for x in stride(from: 0.0, through: size.width, by: step) {
            let progress = x / max(size.width, 1)
            let y = baseline
                + sin(progress * .pi * 3.2 + phase) * amplitude
                + sin(progress * .pi * 6.4 - phase * 0.7) * 2.4
            if x == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }
        return path
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
