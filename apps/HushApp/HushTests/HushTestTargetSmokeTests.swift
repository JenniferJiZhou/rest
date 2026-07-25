import XCTest
@testable import Hush

final class HushTestTargetSmokeTests: XCTestCase {
    func testTargetLoadsApplicationModule() {
        XCTAssertEqual(GeneratedRestTask(title: "停一下", durationSeconds: 60, steps: ["呼吸"]).durationSeconds, 60)
    }
}
