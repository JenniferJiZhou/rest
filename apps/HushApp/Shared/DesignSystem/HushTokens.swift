import SwiftUI

enum HushColor {
    static let ink = Color.black
    static let inkMuted = Color.white.opacity(0.46)
    static let midnight = Color.black
    static let dusk = Color.black
    static let indigo = Color.white
    static let violet = Color.white.opacity(0.84)
    static let cyan = Color.white.opacity(0.92)
    static let mint = Color.white.opacity(0.88)
    static let warm = Color.white.opacity(0.70)
    static let textPrimary = Color.white.opacity(0.94)
    static let textSecondary = Color.white.opacity(0.52)
    static let panel = Color.white.opacity(0.04)
    static let panelStrong = Color.white.opacity(0.065)
    static let hairline = Color.white.opacity(0.10)
}

enum HushSpacing {
    static let xxs: CGFloat = 4
    static let xs: CGFloat = 8
    static let sm: CGFloat = 12
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
    static let xxl: CGFloat = 44
}

enum HushRadius {
    static let small: CGFloat = 12
    static let medium: CGFloat = 18
    static let large: CGFloat = 28
    static let capsule: CGFloat = 999
}

enum HushType {
    static let eyebrow = Font.system(size: 11, weight: .semibold, design: .rounded)
    static let micro = Font.system(size: 10, weight: .regular, design: .rounded)
    static let caption = Font.system(size: 12, weight: .medium, design: .rounded)
    static let body = Font.system(size: 15, weight: .regular, design: .rounded)
    static let bodyStrong = Font.system(size: 15, weight: .semibold, design: .rounded)
    static let title = Font.system(size: 25, weight: .semibold, design: .rounded)
    static let hero = Font.system(size: 36, weight: .medium, design: .rounded)
    static let agentTask = Font.system(size: 20, weight: .regular, design: .rounded)
    static let timer = Font.system(size: 54, weight: .light, design: .rounded).monospacedDigit()
}
