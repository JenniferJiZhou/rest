import SwiftUI

struct RestQuestView: View {
    let quest: HushQuestContent
    let canSwap: Bool
    let onSwap: () -> Void
    let onStart: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: HushSpacing.lg) {
            VStack(alignment: .leading, spacing: HushSpacing.xs) {
                HushSectionLabel(text: "Your rest quest")
                Text("先做这一件小事。")
                    .font(HushType.title)
                    .foregroundStyle(HushColor.textPrimary)
            }

            VStack(alignment: .leading, spacing: HushSpacing.lg) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: HushSpacing.xs) {
                        Text(quest.title)
                            .font(.system(size: 28, weight: .semibold, design: .rounded))
                            .foregroundStyle(HushColor.textPrimary)

                        HStack(spacing: HushSpacing.xs) {
                            Label(quest.durationLabel, systemImage: "timer")
                            Label("不用盯屏幕", systemImage: "rectangle.slash")
                        }
                        .font(HushType.micro)
                        .foregroundStyle(HushColor.textSecondary)
                    }

                    Spacer()

                    ZStack {
                        Circle()
                            .fill(HushColor.cyan.opacity(0.12))
                            .frame(width: 48, height: 48)
                        Image(systemName: "figure.mind.and.body")
                            .foregroundStyle(HushColor.cyan)
                    }
                }

                VStack(spacing: HushSpacing.md) {
                    ForEach(Array(quest.steps.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .top, spacing: HushSpacing.sm) {
                            Text("\(index + 1)")
                                .font(HushType.caption)
                                .foregroundStyle(HushColor.midnight)
                                .frame(width: 24, height: 24)
                                .background(Circle().fill(HushColor.mint))

                            Text(step)
                                .font(HushType.body)
                                .foregroundStyle(HushColor.textPrimary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 2)
                        }
                    }
                }

                if let safetyNote = quest.safetyNote {
                    Label(safetyNote, systemImage: "shield")
                        .font(HushType.micro)
                        .foregroundStyle(HushColor.textSecondary)
                }
            }
            .hushPanel(emphasized: true)

            VStack(spacing: HushSpacing.sm) {
                Button(action: onStart) {
                    Label("开始 \(quest.durationLabel)", systemImage: "play.fill")
                }
                .buttonStyle(HushPrimaryButtonStyle())

                Button(action: onSwap) {
                    Label("换一个", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(HushSecondaryButtonStyle())
                .disabled(!canSwap)
            }

        }
    }
}
