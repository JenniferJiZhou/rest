import SwiftUI

struct PauseReceiptView: View {
    let onBlueReset: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: HushSpacing.lg) {
            VStack(alignment: .leading, spacing: HushSpacing.xs) {
                HushSectionLabel(text: "Pause receipt")
                Text("今晚可以先停了。")
                    .font(HushType.title)
                    .foregroundStyle(HushColor.textPrimary)
                Text("在已授权 Gmail 和你主动交接的事项中，没有发现必须今晚处理的内容。")
                    .font(HushType.body)
                    .foregroundStyle(HushColor.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: HushSpacing.md) {
                HushSectionLabel(text: "Hush 已接住")

                receiptRow(
                    icon: "doc.text.fill",
                    title: "回复李老师",
                    detail: "Gmail 草稿已保存",
                    color: HushColor.mint
                )
                receiptRow(
                    icon: "sunrise.fill",
                    title: "检查首页深色模式按钮",
                    detail: "已放到明天",
                    color: HushColor.cyan
                )
                receiptRow(
                    icon: "questionmark.circle.fill",
                    title: "确认活动材料截止时间",
                    detail: "时间不明确，保留为待确认",
                    color: HushColor.warm
                )
            }
            .hushPanel(emphasized: true)

            VStack(alignment: .leading, spacing: HushSpacing.sm) {
                HushSectionLabel(text: "本次覆盖范围")

                FlowLayout(spacing: 8) {
                    HushSourcePill(text: "已授权 Gmail")
                    HushSourcePill(text: "主动交接事项")
                    HushSourcePill(text: "微信", included: false)
                    HushSourcePill(text: "电话", included: false)
                    HushSourcePill(text: "其他未连接渠道", included: false)
                }

                Text("未连接渠道不在结论范围内。")
                    .font(HushType.micro)
                    .foregroundStyle(HushColor.textSecondary)
            }

            VStack(alignment: .leading, spacing: HushSpacing.xs) {
                Text("明天第一步")
                    .font(HushType.micro)
                    .foregroundStyle(HushColor.textSecondary)
                Text("先查看活动材料邮件的截止时间。")
                    .font(HushType.bodyStrong)
                    .foregroundStyle(HushColor.textPrimary)
            }
            .hushPanel()

            Button(action: onBlueReset) {
                Label("进入 Blue Reset", systemImage: "moon.zzz.fill")
            }
            .buttonStyle(HushPrimaryButtonStyle())

        }
    }

    private func receiptRow(icon: String, title: String, detail: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: HushSpacing.sm) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(HushType.bodyStrong)
                    .foregroundStyle(HushColor.textPrimary)
                Text(detail)
                    .font(HushType.micro)
                    .foregroundStyle(HushColor.textSecondary)
            }
            Spacer()
        }
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let result = layout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let result = layout(
            proposal: ProposedViewSize(width: bounds.width, height: proposal.height),
            subviews: subviews
        )
        for (index, point) in result.points.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
        }
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var points: [CGPoint] = []
        var cursor = CGPoint.zero
        var rowHeight: CGFloat = 0
        var usedWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if cursor.x > 0, cursor.x + size.width > maxWidth {
                cursor.x = 0
                cursor.y += rowHeight + spacing
                rowHeight = 0
            }
            points.append(cursor)
            cursor.x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            usedWidth = max(usedWidth, cursor.x - spacing)
        }

        return (CGSize(width: usedWidth, height: cursor.y + rowHeight), points)
    }
}
