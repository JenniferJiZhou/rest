import Foundation

struct HushManualRestRecommendation {
    let quest: HushQuestContent
    let intro: String?
}

protocol HushCompanionRestAgentServing {
    func recommendManualRest(
        from snapshot: HushCompanionSnapshot,
        content: HushDemoContentSnapshot
    ) async throws -> HushManualRestRecommendation
}

struct HTTPHushCompanionRestAgentService:
    HushCompanionRestAgentServing
{
    enum ServiceError: LocalizedError {
        case missingBaseURL
        case invalidResponse
        case questUnavailable
        case requestFailed(Int)

        var errorDescription: String? {
            switch self {
            case .missingBaseURL:
                return "请先在设置中填写 Agent 的 HTTPS 地址。"
            case .invalidResponse:
                return "Agent 返回了无法识别的休息建议。"
            case .questUnavailable:
                return "Agent 推荐的休息内容不在当前内容库中。"
            case let .requestFailed(statusCode):
                return "Agent 暂时不可用（HTTP \(statusCode)）。"
            }
        }
    }

    func recommendManualRest(
        from snapshot: HushCompanionSnapshot,
        content: HushDemoContentSnapshot
    ) async throws -> HushManualRestRecommendation {
        guard let provider = HTTPManualRestTaskProvider.automatic else {
            throw ServiceError.missingBaseURL
        }

        do {
            let suggestion = try await provider.generateTask(
                context: HushManualRestContext(
                    sessionID: snapshot.sessionID,
                    fatigueType: "unknown",
                    userPreference: "surprise",
                    availableMinutes: 3,
                    source: "manual_ios",
                    locationTags: ["any"]
                )
            )
            return HushManualRestRecommendation(
                quest: suggestion.generatedTask.questContent,
                intro: suggestion.message
            )
        } catch {
            throw ServiceError.invalidResponse
        }
    }
}
