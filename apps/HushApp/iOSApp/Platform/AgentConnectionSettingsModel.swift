import Foundation

@MainActor
final class AgentConnectionSettingsModel: ObservableObject {
    @Published var baseURL: String {
        didSet {
            defaults?.set(baseURL.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Self.baseURLKey)
        }
    }

    @Published private(set) var lastResultMessage: String?

    private static let appGroupIdentifier = "group.com.JenniferJi.Hush"
    private static let baseURLKey = "agent.baseURL"
    private static let lastDecisionKey = "agent.lastDecisionMessage"
    private static let lastErrorKey = "agent.lastErrorMessage"

    private let defaults: UserDefaults?

    init() {
        let defaults = UserDefaults(suiteName: Self.appGroupIdentifier)
        self.defaults = defaults
        baseURL = defaults?.string(forKey: Self.baseURLKey) ?? ""
        refreshLastResult()
    }

    var isConfigured: Bool {
        guard
            let url = URL(
                string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            ),
            url.scheme?.lowercased() == "https",
            url.host != nil
        else {
            return false
        }

        return true
    }

    var statusMessage: String {
        if baseURL.isEmpty {
            return "填写 HTTPS 服务地址后才能启动。"
        }

        if !isConfigured {
            return "服务地址必须是有效的 HTTPS 地址。"
        }

        return "云端 Agent 已配置。每个 App 的名称来自你的主动填写。"
    }

    func refreshLastResult() {
        if let error = defaults?.string(forKey: Self.lastErrorKey) {
            lastResultMessage = "最近请求：\(error)"
        } else if let decision = defaults?.string(forKey: Self.lastDecisionKey) {
            lastResultMessage = decision.isEmpty
                ? "最近请求成功，Agent 建议继续观察。"
                : "最近决策：\(decision)"
        } else {
            lastResultMessage = nil
        }
    }
}
