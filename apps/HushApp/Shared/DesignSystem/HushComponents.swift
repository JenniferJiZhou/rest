import SwiftUI

struct HushPanelModifier: ViewModifier {
    var emphasized = false

    func body(content: Content) -> some View {
        content
            .padding(HushSpacing.lg)
            .background(
                RoundedRectangle(cornerRadius: HushRadius.large, style: .continuous)
                    .fill(emphasized ? HushColor.panelStrong : HushColor.panel)
                    .overlay(
                        RoundedRectangle(cornerRadius: HushRadius.large, style: .continuous)
                            .stroke(HushColor.hairline, lineWidth: 1)
                    )
            )
    }
}

extension View {
    func hushPanel(emphasized: Bool = false) -> some View {
        modifier(HushPanelModifier(emphasized: emphasized))
    }
}

struct HushPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(HushType.bodyStrong)
            .foregroundStyle(Color.black)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 48)
            .padding(.horizontal, HushSpacing.md)
            .background(
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [Color.white, Color.white.opacity(0.82)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
            )
            .overlay(Capsule().stroke(Color.white.opacity(0.32), lineWidth: 1))
            .shadow(
                color: Color.white.opacity(configuration.isPressed ? 0.04 : 0.10),
                radius: configuration.isPressed ? 4 : 12,
                y: configuration.isPressed ? 1 : 5
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(isEnabled ? 1 : 0.38)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct HushSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(HushType.bodyStrong)
            .foregroundStyle(HushColor.textPrimary)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 46)
            .padding(.horizontal, HushSpacing.md)
            .background(Capsule().fill(Color.white.opacity(configuration.isPressed ? 0.15 : 0.08)))
            .overlay(Capsule().stroke(HushColor.hairline, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(isEnabled ? 1 : 0.38)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct HushCompactButtonStyle: ButtonStyle {
    var selected = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(HushType.caption)
            .foregroundStyle(selected ? Color.white : HushColor.textSecondary)
            .padding(.horizontal, HushSpacing.sm)
            .frame(minHeight: 34)
            .background(
                Capsule()
                    .fill(selected ? HushColor.indigo.opacity(0.74) : Color.white.opacity(0.07))
            )
            .overlay(Capsule().stroke(HushColor.hairline, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}

struct HushSampleModeBadge: View {
    var degraded = false

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(degraded ? HushColor.warm : HushColor.mint)
                .frame(width: 6, height: 6)
            Text(degraded ? "演示模式 · 备用内容" : "演示模式")
                .font(HushType.micro)
                .tracking(0.4)
        }
        .foregroundStyle(HushColor.textSecondary)
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(Capsule().fill(Color.black.opacity(0.18)))
        .overlay(Capsule().stroke(HushColor.hairline, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(degraded ? "演示模式，当前使用备用内容" : "当前为演示模式")
    }
}

struct HushSectionLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(HushType.eyebrow)
            .tracking(1.2)
            .foregroundStyle(HushColor.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct HushSourcePill: View {
    let text: String
    var included = true

    var body: some View {
        Label(text, systemImage: included ? "checkmark.circle.fill" : "minus.circle")
            .font(HushType.micro)
            .foregroundStyle(included ? HushColor.mint : HushColor.textSecondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(Capsule().fill(Color.white.opacity(0.06)))
    }
}

struct HushHeroMark: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [HushColor.cyan.opacity(0.35), HushColor.violet.opacity(0.16), .clear],
                        center: .center,
                        startRadius: 2,
                        endRadius: 52
                    )
                )
                .frame(width: 104, height: 104)

            Image(systemName: "waveform.path")
                .font(.system(size: 36, weight: .light))
                .symbolRenderingMode(.palette)
                .foregroundStyle(HushColor.cyan, HushColor.violet)
        }
        .accessibilityHidden(true)
    }
}
