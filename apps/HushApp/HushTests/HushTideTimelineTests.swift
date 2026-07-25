import XCTest
@testable import Hush

final class HushTideTimelineTests: XCTestCase {
    func testTideProgressIsBoundedAndMonotonic() {
        let samples = stride(from: 0.0, through: 5.0, by: 0.05)
            .map { HushTideTimeline.tideProgress(elapsed: $0) }
        XCTAssertEqual(samples.first!, 0, accuracy: 0.0001)
        XCTAssertEqual(samples.last!, 1, accuracy: 0.0001)
        XCTAssertTrue(zip(samples, samples.dropFirst()).allSatisfy { $0 <= $1 })
    }
}
