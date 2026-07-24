import SwiftUI

private enum HushHelpfulness: String, CaseIterable, Identifiable {
    case helped
    case noChange
    case interrupted

    var id: String { rawValue }

    var title: String {
        switch self {
        case .helped: return "有一点帮助"
        case .noChange: return "没什么变化"
        case .interrupted: return "被打断了"
        }
    }
}

private enum HushTiming: String, CaseIterable, Identifiable {
    case tooEarly
    case right
    case tooLate

    var id: String { rawValue }

    var title: String {
        switch self {
        case .tooEarly: return "早了"
        case .right: return "刚好"
        case .tooLate: return "晚了"
        }
    }
}

struct RestFeedbackView: View {
    let onSubmit: () -> Void

    @State private var helpfulness: HushHelpfulness?
    @State private var timing: HushTiming?

    var body: some View {
        VStack(alignment: .leading, spacing: HushSpacing.xl) {
            VStack(alignment: .leading, spacing: HushSpacing.xs) {
                HushSectionLabel(text: "Two small questions")
                Text("刚才那一下，怎么样？")
                    .font(HushType.title)
                    .foregroundStyle(HushColor.textPrimary)
                Text("不需要写感想，点两下就结束。")
                    .font(HushType.body)
                    .foregroundStyle(HushColor.textSecondary)
            }

            feedbackGroup(title: "它有帮到你一点吗？") {
                ForEach(HushHelpfulness.allCases) { option in
                    Button(option.title) {
                        helpfulness = option
                    }
                    .buttonStyle(HushCompactButtonStyle(selected: helpfulness == option))
                }
            }

            feedbackGroup(title: "出现的时机呢？") {
                ForEach(HushTiming.allCases) { option in
                    Button(option.title) {
                        timing = option
                    }
                    .buttonStyle(HushCompactButtonStyle(selected: timing == option))
                }
            }

            Button(action: onSubmit) {
                Text("记下这次暂停")
            }
            .buttonStyle(HushPrimaryButtonStyle())
            .disabled(helpfulness == nil || timing == nil)

        }
    }

    private func feedbackGroup<Content: View>(
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: HushSpacing.md) {
            Text(title)
                .font(HushType.bodyStrong)
                .foregroundStyle(HushColor.textPrimary)

            HStack(spacing: HushSpacing.xs) {
                content()
            }
        }
        .hushPanel()
    }
}

struct RestCompletionView: View {
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: HushSpacing.xl) {
            Spacer(minLength: HushSpacing.xl)

            ZStack {
                Circle()
                    .fill(HushColor.mint.opacity(0.14))
                    .frame(width: 96, height: 96)
                Image(systemName: "checkmark")
                    .font(.system(size: 36, weight: .light))
                    .foregroundStyle(HushColor.mint)
            }

            VStack(spacing: HushSpacing.sm) {
                Text("这次停顿，算数。")
                    .font(HushType.title)
                    .foregroundStyle(HushColor.textPrimary)
                Text("不用立刻变得精力充沛。现在比刚才多了一点空间，就够了。")
                    .font(HushType.body)
                    .foregroundStyle(HushColor.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Button(action: onDone) {
                Text("回到 Hush")
            }
            .buttonStyle(HushPrimaryButtonStyle())

            Spacer(minLength: HushSpacing.xl)
        }
    }
}
