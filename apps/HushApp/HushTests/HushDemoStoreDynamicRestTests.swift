import XCTest
@testable import Hush

final class HushDemoStoreDynamicRestTests: XCTestCase {
    @MainActor
    func testGeneratedTaskSurvivesVisualRouteChanges() {
        let task = GeneratedRestTask(
            title: "望向远处",
            durationSeconds: 60,
            steps: ["看向窗外"]
        )
        let store = HushDemoStore(
            provider: StubContentProvider(),
            manualRestProvider: nil
        )

        store.presentRestSuggestion(task: task)
        XCTAssertEqual(store.generatedRestTask, task)

        store.openInbox()
        store.closeInbox()

        XCTAssertEqual(store.generatedRestTask, task)
    }
}

private struct StubContentProvider: HushRestContentProviding {
    enum StubError: Error { case unavailable }

    func loadManifest() throws -> HushContentManifest {
        throw StubError.unavailable
    }

    func loadQuests() throws -> [HushQuestContent] {
        throw StubError.unavailable
    }

    func loadDriftPrompts() throws -> [HushDriftPrompt] {
        throw StubError.unavailable
    }

    func loadBlueBoxCards() throws -> [HushBlueBoxCard] {
        throw StubError.unavailable
    }
}
