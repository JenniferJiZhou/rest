import SwiftUI

struct FatigueCheckInView: View {
    @Binding var description: String
    @Binding var availableMinutes: Int
    let onContinue: () -> Void

    private let quickTags = ["脑子很满", "眼睛很累", "身体发紧", "不想再说话", "睡不下来"]

    var body: some View {
        VStack(alignment: .leading, spacing: HushSpacing.lg) {
            VStack(alignment: .leading, spacing: HushSpacing.xs) {
                HushSectionLabel(text: "Name the tiredness")
                Text("这种累，更像什么？")
                    .font(HushType.title)
                    .foregroundStyle(HushColor.textPrimary)
                Text("一句话就够，不需要解释完整。")
                    .font(HushType.body)
                    .foregroundStyle(HushColor.textSecondary)
            }

            VStack(alignment: .leading, spacing: HushSpacing.sm) {
                TextEditor(text: $description)
                    .font(HushType.body)
                    .foregroundStyle(HushColor.textPrimary)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 112)
                    .padding(HushSpacing.sm)
                    .background(
                        RoundedRectangle(cornerRadius: HushRadius.medium, style: .continuous)
                            .fill(Color.black.opacity(0.18))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: HushRadius.medium, style: .continuous)
                            .stroke(HushColor.hairline, lineWidth: 1)
                    )
                    .accessibilityLabel("描述你的疲惫")

                Text("\(description.count) / 500")
                    .font(HushType.micro)
                    .foregroundStyle(HushColor.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .hushPanel()

            VStack(alignment: .leading, spacing: HushSpacing.sm) {
                Text("也可以直接选")
                    .font(HushType.bodyStrong)
                    .foregroundStyle(HushColor.textPrimary)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 102), spacing: 8)], spacing: 8) {
                    ForEach(quickTags, id: \.self) { tag in
                        Button(tag) {
                            description = tag
                        }
                        .buttonStyle(HushCompactButtonStyle(selected: description == tag))
                    }
                }
            }

            VStack(alignment: .leading, spacing: HushSpacing.xs) {
                Text("你现在有几分钟？")
                    .font(HushType.bodyStrong)
                    .foregroundStyle(HushColor.textPrimary)

                Picker("可用时间", selection: $availableMinutes) {
                    ForEach([1, 3, 5], id: \.self) { minute in
                        Text("\(minute) 分钟").tag(minute)
                    }
                }
                .pickerStyle(.segmented)
            }

            Button(action: onContinue) {
                Text("继续")
            }
            .buttonStyle(HushPrimaryButtonStyle())
            .disabled(description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }
}

struct FatigueReflectionView: View {
    let onChoose: (HushDemoPreference) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: HushSpacing.lg) {
            HushSectionLabel(text: "A small reflection")

            VStack(alignment: .leading, spacing: HushSpacing.md) {
                Image(systemName: "quote.opening")
                    .font(.title2)
                    .foregroundStyle(HushColor.cyan)

                Text("听起来不像单纯的困，更像是接收了太多信息，大脑还没有慢下来。")
                    .font(.system(size: 22, weight: .medium, design: .rounded))
                    .foregroundStyle(HushColor.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                Text("仅用于选择更合适的休息方式。")
                    .font(HushType.micro)
                    .foregroundStyle(HushColor.textSecondary)
            }
            .hushPanel(emphasized: true)

            VStack(alignment: .leading, spacing: HushSpacing.sm) {
                Text("你现在更想——")
                    .font(HushType.bodyStrong)
                    .foregroundStyle(HushColor.textPrimary)

                ForEach(HushDemoPreference.allCases) { preference in
                    Button {
                        onChoose(preference)
                    } label: {
                        HStack {
                            Image(systemName: preference == .quiet ? "speaker.slash" : "figure.walk")
                            Text(preference.title)
                            Spacer()
                            Image(systemName: "arrow.right")
                        }
                    }
                    .buttonStyle(HushSecondaryButtonStyle())
                }
            }

        }
    }
}
