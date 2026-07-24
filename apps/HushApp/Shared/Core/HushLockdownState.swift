import Foundation

struct HushLockdownState: Codable, Equatable, Identifiable {
    static let appGroupIdentifier = "group.com.JenniferJi.Hush"
    static let storageKey = "interruption.activeLockdown"

    let id: UUID
    let userProvidedContextLabel: String
    let message: String
    let activatedAt: Date

    static func load() -> HushLockdownState? {
        guard
            let defaults = UserDefaults(
                suiteName: appGroupIdentifier
            ),
            let data = defaults.data(forKey: storageKey)
        else {
            return nil
        }

        return try? PropertyListDecoder().decode(
            HushLockdownState.self,
            from: data
        )
    }

    func persist() {
        guard
            let defaults = UserDefaults(
                suiteName: Self.appGroupIdentifier
            ),
            let data = try? PropertyListEncoder().encode(self)
        else {
            return
        }

        defaults.set(data, forKey: Self.storageKey)
    }

    static func clear() {
        UserDefaults(suiteName: appGroupIdentifier)?
            .removeObject(forKey: storageKey)
    }
}
