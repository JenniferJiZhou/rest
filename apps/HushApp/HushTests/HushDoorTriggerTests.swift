import XCTest
@testable import Hush

final class HushDoorTriggerTests: XCTestCase {
    func testSwipeTriggerUsesDistanceOrFlickThreshold() {
        XCTAssertFalse(HushDoorSwipeTrigger.shouldTrigger(translationY: -43, velocityY: 0))
        XCTAssertTrue(HushDoorSwipeTrigger.shouldTrigger(translationY: -44, velocityY: 0))
        XCTAssertTrue(HushDoorSwipeTrigger.shouldTrigger(translationY: -12, velocityY: -700))
        XCTAssertFalse(HushDoorSwipeTrigger.shouldTrigger(translationY: 20, velocityY: -50))
    }
}
