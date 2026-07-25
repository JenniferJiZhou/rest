import CoreGraphics
import XCTest
@testable import Hush

final class HushSleepExitPolicyTests: XCTestCase {
    func testQuestionnaireDragCannotStartExit() {
        XCTAssertFalse(
            HushSleepExitPolicy.isEligible(
                isComplete: false,
                startLocation: CGPoint(x: 195, y: 700),
                translation: CGSize(width: 0, height: -300),
                containerSize: CGSize(width: 390, height: 844)
            )
        )
    }

    func testCompletedUpwardDragCanStartExit() {
        XCTAssertTrue(
            HushSleepExitPolicy.isEligible(
                isComplete: true,
                startLocation: CGPoint(x: 195, y: 700),
                translation: CGSize(width: 0, height: -300),
                containerSize: CGSize(width: 390, height: 844)
            )
        )
    }

    func testReduceMotionUsesFastExitDuration() {
        XCTAssertEqual(
            HushSleepExitPolicy.completionDuration(reduceMotion: true),
            0.2,
            accuracy: 0.0001
        )
        XCTAssertEqual(
            HushSleepExitPolicy.completionDuration(reduceMotion: false),
            1.35,
            accuracy: 0.0001
        )
    }
}
