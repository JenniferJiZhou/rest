import SwiftUI

struct GuidedDriftView: View {
    let prompt: HushDriftPrompt

    var body: some View {
        VStack(alignment: .leading, spacing: HushSpacing.sm) {
            HStack {
                Label("一个轻问题", systemImage: "wind")
                    .font(HushType.bodyStrong)
                    .foregroundStyle(HushColor.cyan)
                Spacer()
                Text("不保存答案")
                    .font(HushType.eyebrow)
                    .foregroundStyle(HushColor.mint)
            }

            Text(prompt.text)
                .font(.system(size: 20, weight: .medium, design: .rounded))
                .foregroundStyle(HushColor.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            Text("不用回答给 Hush。让这个问题在脑子里轻轻飘过去就好。")
                .font(HushType.micro)
                .foregroundStyle(HushColor.textSecondary)
        }
        .hushPanel()
        .accessibilityElement(children: .combine)
    }
}
