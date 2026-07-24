import SwiftUI

struct HushDoorView: View {
    let taskText: String
    let onOpenTask: () -> Void
    let onSettings: () -> Void

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topTrailing) {
                Button(action: onOpenTask) {
                    HushTypewriterText(text: taskText)
                        .frame(
                            width: min(290, geometry.size.width - 88),
                            alignment: .leading
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(taskText)
                .accessibilityHint("打开任务详情")
                .position(
                    x: geometry.size.width * 0.43,
                    y: geometry.size.height * 0.57
                )

                Button(action: onSettings) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 15, weight: .regular))
                        .foregroundStyle(Color.white.opacity(0.78))
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Color.white.opacity(0.035)))
                        .overlay(Circle().stroke(Color.white.opacity(0.12), lineWidth: 0.8))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("设置")
                .padding(.top, HushSpacing.md)
                .padding(.trailing, HushSpacing.lg)
            }
        }
    }
}

private struct HushTypewriterText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let text: String

    @State private var settledText = ""
    @State private var activeCharacter = ""
    @State private var activeOpacity = 0.0

    var body: some View {
        ZStack(alignment: .topLeading) {
            Text(text)
                .hidden()
                .accessibilityHidden(true)

            Text("\(Text(settledText))\(Text(activeCharacter).foregroundColor(Color.white.opacity(0.94 * activeOpacity)))")
        }
        .font(HushType.agentTask)
        .tracking(0.8)
        .lineSpacing(6)
        .foregroundStyle(Color.white.opacity(0.94))
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
        .task(id: text) {
            await revealText()
        }
    }

    @MainActor
    private func revealText() async {
        settledText = ""
        activeCharacter = ""
        activeOpacity = 0

        guard !reduceMotion else {
            settledText = text
            return
        }

        do {
            try await Task.sleep(nanoseconds: 220_000_000)
        } catch {
            return
        }

        for character in text {
            guard !Task.isCancelled else { return }

            if character == "\n" {
                settledText.append(character)
                do {
                    try await Task.sleep(nanoseconds: 45_000_000)
                } catch {
                    return
                }
                continue
            }

            activeCharacter = String(character)
            activeOpacity = 0

            withAnimation(.easeOut(duration: 0.085)) {
                activeOpacity = 1
            }

            let cadence: UInt64
            switch character {
            case "，", "、":
                cadence = 125_000_000
            case "。", "！", "？":
                cadence = 180_000_000
            default:
                cadence = 72_000_000
            }

            do {
                try await Task.sleep(nanoseconds: cadence)
            } catch {
                return
            }

            settledText.append(character)
            activeCharacter = ""
            activeOpacity = 0
        }
    }
}
