import ActivityKit
import Foundation

struct HushRestAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        enum Phase: String, Codable, Hashable {
            case running
            case paused
            case completed
            case ended
        }

        var phase: Phase
        var expectedEndDate: Date?
        var remainingSeconds: Int
    }

    var sessionName: String
}
