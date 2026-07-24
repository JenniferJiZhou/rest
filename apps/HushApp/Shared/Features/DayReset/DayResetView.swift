import SwiftUI

struct DayResetView: View {
    let quest: HushQuestContent
    let prompt: HushDriftPrompt
    let onFinish: () -> Void

    @State private var remainingSeconds: Int
    @State private var isRunning = true
    @State private var showDrift = false

    init(quest: HushQuestContent, prompt: HushDriftPrompt, onFinish: @escaping () -> Void) {
        self.quest = quest
        self.prompt = prompt
        self.onFinish = onFinish
        _remainingSeconds = State(initialValue: quest.durationSeconds)
    }

    var body: some View {
        VStack(spacing: HushSpacing.lg) {
            HushSectionLabel(text: "Day reset")

            VStack(spacing: HushSpacing.md) {
                Text(quest.title)
                    .font(HushType.bodyStrong)
                    .foregroundStyle(HushColor.textSecondary)

                Text(timeLabel)
                    .font(HushType.timer)
                    .foregroundStyle(HushColor.textPrimary)
                    .contentTransition(.numericText())
                    .accessibilityLabel("剩余 \(remainingSeconds) 秒")

                ProgressView(value: progress)
                    .tint(HushColor.cyan)
                    .scaleEffect(x: 1, y: 1.6)

                Text(isRunning ? "屏幕可以放下，计时会继续。" : "已经暂停，按继续后恢复计时。")
                    .font(HushType.micro)
                    .foregroundStyle(HushColor.textSecondary)
            }
            .hushPanel(emphasized: true)

            if showDrift {
                GuidedDriftView(prompt: prompt)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            } else {
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        showDrift = true
                    }
                } label: {
                    Label("给我一个轻问题", systemImage: "wind")
                }
                .buttonStyle(HushSecondaryButtonStyle())
            }

            HStack(spacing: HushSpacing.sm) {
                Button {
                    isRunning.toggle()
                } label: {
                    Label(isRunning ? "暂停" : "继续", systemImage: isRunning ? "pause.fill" : "play.fill")
                }
                .buttonStyle(HushSecondaryButtonStyle())

                Button(action: onFinish) {
                    Text("提前结束")
                }
                .buttonStyle(HushSecondaryButtonStyle())
            }

        }
        .task {
            while remainingSeconds > 0, !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                } catch {
                    return
                }

                guard isRunning else { continue }
                remainingSeconds -= 1
                if remainingSeconds == 0 {
                    onFinish()
                }
            }
        }
    }

    private var progress: Double {
        guard quest.durationSeconds > 0 else { return 1 }
        return 1 - Double(remainingSeconds) / Double(quest.durationSeconds)
    }

    private var timeLabel: String {
        String(format: "%d:%02d", remainingSeconds / 60, remainingSeconds % 60)
    }
}
