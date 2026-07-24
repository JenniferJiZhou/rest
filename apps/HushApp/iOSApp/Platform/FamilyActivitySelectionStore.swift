import FamilyControls
import Foundation
import ManagedSettings

@MainActor
final class FamilyActivitySelectionStore: ObservableObject {
    struct ApplicationContext: Codable, Equatable, Identifiable {
        let id: UUID
        let token: ApplicationToken
        var userProvidedName: String
    }

    @Published var selection: FamilyActivitySelection {
        didSet {
            persistSelection()
            synchronizeApplicationContexts()
        }
    }

    @Published private(set) var applicationContexts: [ApplicationContext]

    private static let appGroupIdentifier = "group.com.JenniferJi.Hush"
    private static let selectionKey = "familyActivitySelection"
    private static let applicationContextsKey = "applicationContexts"

    private let userDefaults: UserDefaults?

    init() {
        let userDefaults = UserDefaults(suiteName: Self.appGroupIdentifier)
        self.userDefaults = userDefaults

        if
            let data = userDefaults?.data(forKey: Self.selectionKey),
            let storedSelection = try? PropertyListDecoder().decode(
                FamilyActivitySelection.self,
                from: data
            )
        {
            selection = storedSelection
        } else {
            selection = FamilyActivitySelection()
        }

        if
            let data = userDefaults?.data(forKey: Self.applicationContextsKey),
            let storedContexts = try? PropertyListDecoder().decode(
                [ApplicationContext].self,
                from: data
            )
        {
            applicationContexts = storedContexts
        } else {
            applicationContexts = []
        }

        synchronizeApplicationContexts()
    }

    var selectedItemCount: Int {
        selection.applicationTokens.count
            + selection.categoryTokens.count
            + selection.webDomainTokens.count
    }

    var selectionSummary: String {
        guard selectedItemCount > 0 else {
            return "尚未选择 App、类别或网站"
        }

        return "已选择 \(selection.applicationTokens.count) 个 App、"
            + "\(selection.categoryTokens.count) 个类别、"
            + "\(selection.webDomainTokens.count) 个网站"
    }

    var allApplicationNamesConfigured: Bool {
        !applicationContexts.isEmpty
            && applicationContexts.allSatisfy {
                !$0.userProvidedName
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .isEmpty
            }
    }

    var applicationConfigurationMessage: String? {
        if selection.applicationTokens.isEmpty {
            return "Demo 目前需要至少选择一个具体 App。"
        }

        if !allApplicationNamesConfigured {
            return "请为每个 App 填写一个发送给 Agent 的名称。"
        }

        if !selection.categoryTokens.isEmpty
            || !selection.webDomainTokens.isEmpty
        {
            return "Demo 暂时只监测具体 App；类别和网站不会加入检查。"
        }

        return nil
    }

    var configuredApplicationContexts: [ApplicationContext] {
        applicationContexts.map { context in
            var configuredContext = context
            configuredContext.userProvidedName = context.userProvidedName
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return configuredContext
        }
    }

    func userProvidedName(for contextID: UUID) -> String {
        applicationContexts.first { $0.id == contextID }?
            .userProvidedName ?? ""
    }

    func updateUserProvidedName(_ name: String, for contextID: UUID) {
        guard
            let index = applicationContexts.firstIndex(
                where: { $0.id == contextID }
            )
        else {
            return
        }

        applicationContexts[index].userProvidedName = name
        persistApplicationContexts()
    }

    func clearSelection() {
        selection = FamilyActivitySelection()
    }

    private func persistSelection() {
        guard let data = try? PropertyListEncoder().encode(selection) else {
            return
        }

        userDefaults?.set(data, forKey: Self.selectionKey)
    }

    private func synchronizeApplicationContexts() {
        let selectedTokens = selection.applicationTokens
        var synchronizedContexts = applicationContexts.filter {
            selectedTokens.contains($0.token)
        }

        for token in selectedTokens
        where !synchronizedContexts.contains(where: { $0.token == token }) {
            synchronizedContexts.append(
                ApplicationContext(
                    id: UUID(),
                    token: token,
                    userProvidedName: ""
                )
            )
        }

        guard synchronizedContexts != applicationContexts else {
            return
        }

        applicationContexts = synchronizedContexts
        persistApplicationContexts()
    }

    private func persistApplicationContexts() {
        guard
            let data = try? PropertyListEncoder().encode(applicationContexts)
        else {
            return
        }

        userDefaults?.set(data, forKey: Self.applicationContextsKey)
    }
}
