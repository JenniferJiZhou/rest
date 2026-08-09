import Combine
import Foundation

@MainActor
final class HushAgentTaskTestModel: ObservableObject {
    struct PreviewRow: Equatable, Sendable {
        let label: String
        let value: String
    }

    enum State: Equatable {
        case idle
        case loading
        case success(HushDynamicRestSuggestion)
        case failure(String)
    }

    typealias Request = @Sendable (
        String,
        HushManualRestContext
    ) async throws -> HushDynamicRestSuggestion

    @Published private(set) var state: State = .idle

    private let request: Request

    init(
        request: @escaping Request = { baseURL, context in
            let provider = try HTTPManualRestTaskProvider(
                baseURLString: baseURL
            )
            return try await provider.generateTask(context: context)
        }
    ) {
        self.request = request
    }

    var isRequesting: Bool {
        state == .loading
    }

    var originLabel: String? {
        guard
            case let .success(suggestion) = state,
            let origin = suggestion.dataOrigin
        else {
            return nil
        }
        switch origin {
        case .real:
            return "真实 Agent"
        case .mock:
            return "测试数据"
        }
    }

    func test(
        baseURL: String,
        context: HushAgentDecisionContext,
        source: String
    ) async {
        guard !isRequesting else { return }
        guard Self.isValidHTTPSBaseURL(baseURL) else {
            state = .failure("请填写有效的 HTTPS Agent 地址")
            return
        }

        state = .loading
        let manualContext = HushManualRestContext(
            sessionID: "settings-agent-test-\(UUID().uuidString.lowercased())",
            fatigueType: "unknown",
            userPreference: "surprise",
            availableMinutes: 3,
            source: source,
            locationTags: [],
            decisionContext: context
        )

        do {
            let suggestion = try await request(baseURL, manualContext)
            guard suggestion.dataOrigin != nil else {
                state = .failure("Agent 返回了无法识别的任务")
                return
            }
            state = .success(suggestion)
        } catch let error as HTTPManualRestTaskProvider.ProviderError {
            switch error {
            case .invalidResponse:
                state = .failure("Agent 返回了无法识别的任务")
            case .invalidBaseURL, .requestFailed:
                state = .failure("无法连接 Agent，请检查地址或稍后重试")
            }
        } catch is DecodingError {
            state = .failure("Agent 返回了无法识别的任务")
        } catch {
            state = .failure("无法连接 Agent，请检查地址或稍后重试")
        }
    }

    func previewRows(
        for context: HushAgentDecisionContext
    ) -> [PreviewRow] {
        [
            PreviewRow(label: "测量时间", value: context.measuredAt),
            PreviewRow(label: "平台", value: context.platform),
            PreviewRow(
                label: "用户填写的名称",
                value: context.userProvidedContextLabel ?? "未知"
            ),
            PreviewRow(
                label: "今日使用",
                value: Self.minutesLabel(context.dailyAppUsageMinutes)
            ),
            PreviewRow(
                label: "连续使用",
                value: Self.continuousMinutesLabel(context)
            ),
            PreviewRow(
                label: "10 分钟内切换",
                value: context.appSwitchesLast10Minutes.map(String.init)
                    ?? "未知"
            ),
            PreviewRow(
                label: "距上次休息",
                value: Self.minutesLabel(context.minutesSinceLastRest)
            ),
            PreviewRow(
                label: "本地时间",
                value: "\(context.localHour):00"
            ),
            PreviewRow(label: "数据用途", value: "不用于个人学习")
        ]
    }

    private static func isValidHTTPSBaseURL(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            let url = URL(string: trimmed),
            url.scheme?.lowercased() == "https",
            url.host != nil
        else {
            return false
        }
        return true
    }

    private static func minutesLabel(_ value: Int?) -> String {
        value.map { "\($0) 分钟" } ?? "未知"
    }

    private static func continuousMinutesLabel(
        _ context: HushAgentDecisionContext
    ) -> String {
        guard let minutes = context.continuousAppUsageMinutes else {
            return "未知"
        }
        return context.continuousUsageIsEstimated == true
            ? "\(minutes) 分钟（估算）"
            : "\(minutes) 分钟"
    }
}
