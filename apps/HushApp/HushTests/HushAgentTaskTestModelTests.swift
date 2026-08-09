import Foundation
import XCTest
@testable import Hush

@MainActor
final class HushAgentTaskTestModelTests: XCTestCase {
    func testInvalidURLNeverInvokesRequest() async {
        let counter = AgentRequestCounter()
        let model = HushAgentTaskTestModel { _, _ in
            await counter.increment()
            return Self.suggestion(origin: .real)
        }

        await model.test(
            baseURL: "http://agent.example.com",
            context: Self.context(),
            source: "settings_agent_test_ios"
        )

        let requestCount = await counter.value
        XCTAssertEqual(requestCount, 0)
        XCTAssertEqual(
            model.state,
            .failure("请填写有效的 HTTPS Agent 地址")
        )
    }

    func testSuccessPublishesReturnedTaskAndOrigin() async {
        let model = HushAgentTaskTestModel { baseURL, context in
            XCTAssertEqual(baseURL, "https://agent.example.com")
            XCTAssertEqual(context.fatigueType, "unknown")
            XCTAssertEqual(context.userPreference, "surprise")
            XCTAssertEqual(context.availableMinutes, 3)
            XCTAssertEqual(context.source, "settings_agent_test_ios")
            XCTAssertEqual(context.locationTags, [])
            XCTAssertEqual(context.decisionContext, Self.context())
            return Self.suggestion(origin: .real)
        }

        await model.test(
            baseURL: "https://agent.example.com",
            context: Self.context(),
            source: "settings_agent_test_ios"
        )

        XCTAssertEqual(model.state, .success(Self.suggestion(origin: .real)))
        XCTAssertEqual(model.originLabel, "真实 Agent")
    }

    func testSecondCallWhileLoadingDoesNotStartAnotherRequest() async {
        let gate = AgentRequestGate()
        let model = HushAgentTaskTestModel { _, _ in
            await gate.wait()
            return Self.suggestion(origin: .mock)
        }

        let first = Task {
            await model.test(
                baseURL: "https://agent.example.com",
                context: Self.context(),
                source: "settings_agent_test_ios"
            )
        }
        await gate.waitUntilEntered()
        XCTAssertEqual(model.state, .loading)

        await model.test(
            baseURL: "https://agent.example.com",
            context: Self.context(),
            source: "settings_agent_test_ios"
        )
        let entryCount = await gate.entryCount
        XCTAssertEqual(entryCount, 1)

        await gate.release()
        await first.value
        XCTAssertEqual(model.state, .success(Self.suggestion(origin: .mock)))
    }

    func testNetworkAndContractErrorsUseDifferentMessages() async {
        let networkModel = HushAgentTaskTestModel { _, _ in
            throw URLError(.timedOut)
        }
        await networkModel.test(
            baseURL: "https://agent.example.com",
            context: Self.context(),
            source: "settings_agent_test_ios"
        )
        XCTAssertEqual(
            networkModel.state,
            .failure("无法连接 Agent，请检查地址或稍后重试")
        )

        let contractModel = HushAgentTaskTestModel { _, _ in
            throw HTTPManualRestTaskProvider.ProviderError.invalidResponse
        }
        await contractModel.test(
            baseURL: "https://agent.example.com",
            context: Self.context(),
            source: "settings_agent_test_ios"
        )
        XCTAssertEqual(
            contractModel.state,
            .failure("Agent 返回了无法识别的任务")
        )
    }

    func testPreviewMarksUnknownAndEstimatedWithoutPrivateFields() {
        let context = HushAgentDecisionContext(
            measuredAt: "2026-08-09T10:15:00+08:00",
            platform: "ios",
            userProvidedContextLabel: nil,
            dailyAppUsageMinutes: nil,
            continuousAppUsageMinutes: 15,
            continuousUsageIsEstimated: true,
            appSwitchesLast10Minutes: nil,
            minutesSinceLastRest: nil,
            localHour: 10,
            rawAppNamesIncluded: false,
            fullURLIncluded: false,
            pageTitleIncluded: false,
            learningEligible: false
        )
        let model = HushAgentTaskTestModel { _, _ in
            Self.suggestion(origin: .real)
        }

        let preview = model.previewRows(for: context)
        let text = preview.map { "\($0.label): \($0.value)" }.joined(separator: "\n")

        XCTAssertTrue(text.contains("未知"))
        XCTAssertTrue(text.contains("15 分钟（估算）"))
        XCTAssertTrue(text.contains("不用于个人学习"))
        XCTAssertFalse(text.contains("Bundle ID"))
        XCTAssertFalse(text.contains("完整网址"))
        XCTAssertFalse(text.contains("页面标题"))
        XCTAssertFalse(text.contains("消息"))
        XCTAssertFalse(text.contains("输入内容"))
    }

    nonisolated private static func context() -> HushAgentDecisionContext {
        HushAgentDecisionContext(
            measuredAt: "2026-08-09T10:15:00+08:00",
            platform: "ios",
            userProvidedContextLabel: "阅读",
            dailyAppUsageMinutes: 35,
            continuousAppUsageMinutes: 15,
            continuousUsageIsEstimated: true,
            appSwitchesLast10Minutes: nil,
            minutesSinceLastRest: 90,
            localHour: 10,
            rawAppNamesIncluded: false,
            fullURLIncluded: false,
            pageTitleIncluded: false,
            learningEligible: false
        )
    }

    nonisolated private static func suggestion(
        origin: HushAgentDataOrigin
    ) -> HushDynamicRestSuggestion {
        HushDynamicRestSuggestion(
            requestID: "req-test",
            message: "现在缓一缓。",
            generatedTask: GeneratedRestTask(
                title: "望向远处",
                durationSeconds: 60,
                steps: ["放松肩膀", "看向远处"]
            ),
            dataOrigin: origin
        )
    }
}

private actor AgentRequestCounter {
    private var count = 0

    var value: Int { count }

    func increment() {
        count += 1
    }
}

private actor AgentRequestGate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var enteredContinuation: CheckedContinuation<Void, Never>?
    private(set) var entryCount = 0

    func wait() async {
        entryCount += 1
        enteredContinuation?.resume()
        enteredContinuation = nil
        await withCheckedContinuation { continuation = $0 }
    }

    func waitUntilEntered() async {
        if entryCount > 0 { return }
        await withCheckedContinuation { enteredContinuation = $0 }
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}
