import Foundation
import ManagedSettings

@MainActor
final class LockdownCoordinator: ObservableObject {
    @Published private(set) var activeState: HushLockdownState?

    private static let managedSettingsStore = ManagedSettingsStore(
        named: ManagedSettingsStore.Name("hush.interruption")
    )

    init() {
        activeState = HushLockdownState.load()
    }

    var isActive: Bool {
        activeState != nil
    }

    func refresh() {
        activeState = HushLockdownState.load()
    }

    func release() {
        Self.managedSettingsStore.clearAllSettings()
        HushLockdownState.clear()
        activeState = nil
    }
}
