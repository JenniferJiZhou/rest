import Foundation
import ManagedSettings

@MainActor
final class InterruptionModeModel: ObservableObject {
    enum Mode: String, CaseIterable, Identifiable {
        case gentle
        case firm

        var id: String {
            rawValue
        }

        var title: String {
            switch self {
            case .gentle:
                return "柔和"
            case .firm:
                return "强提醒"
            }
        }

        var detail: String {
            switch self {
            case .gentle:
                return "达到时长后发送通知，由你决定何时进入 Hush。"
            case .firm:
                return "达到时长后遮住所选 App，并发送通知引导你进入 Hush。"
            }
        }
    }

    @Published var mode: Mode {
        didSet {
            defaults?.set(mode.rawValue, forKey: Self.modeKey)

            if mode == .gentle {
                Self.managedSettingsStore.clearAllSettings()
                HushLockdownState.clear()
            }
        }
    }

    private static let appGroupIdentifier = "group.com.JenniferJi.Hush"
    private static let modeKey = "deviceActivity.interruptionMode"
    private static let managedSettingsStore = ManagedSettingsStore(
        named: ManagedSettingsStore.Name("hush.interruption")
    )

    private let defaults: UserDefaults?

    init() {
        let defaults = UserDefaults(suiteName: Self.appGroupIdentifier)
        self.defaults = defaults
        mode = Mode(
            rawValue: defaults?.string(forKey: Self.modeKey) ?? ""
        ) ?? .gentle

        if mode == .gentle {
            Self.managedSettingsStore.clearAllSettings()
            HushLockdownState.clear()
        }
    }
}
