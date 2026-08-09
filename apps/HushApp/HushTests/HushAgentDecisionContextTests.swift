import Foundation
import XCTest
@testable import Hush

final class HushAgentDecisionContextTests: XCTestCase {
    override func tearDown() {
        ManualRestStubURLProtocol.handler = nil
        super.tearDown()
    }

    func testSettingsRequestEncodesRealContextAndPrivacyFlags() async throws {
        let recorder = ManualRestRequestRecorder()
        ManualRestStubURLProtocol.handler = { request in
            recorder.append(request)
            return try Self.successResponse(for: request, origin: "real")
        }
        let provider = try makeProvider()

        let suggestion = try await provider.generateTask(
            context: HushManualRestContext(
                sessionID: "settings-session",
                fatigueType: "unknown",
                userPreference: "surprise",
                availableMinutes: 3,
                source: "settings_agent_test_ios",
                locationTags: [],
                decisionContext: decisionContext()
            )
        )

        XCTAssertEqual(suggestion.dataOrigin, .real)
        let request = try XCTUnwrap(recorder.requests.first)
        XCTAssertEqual(request.url?.path, "/v1/rest/recommend")
        let body = try XCTUnwrap(request.httpBody)
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )
        XCTAssertEqual(json["source"] as? String, "settings_agent_test_ios")
        let context = try XCTUnwrap(
            json["decision_context"] as? [String: Any]
        )
        XCTAssertEqual(context["measured_at"] as? String, "2026-08-09T10:15:00+08:00")
        XCTAssertEqual(context["platform"] as? String, "ios")
        XCTAssertEqual(context["user_provided_context_label"] as? String, "阅读")
        XCTAssertEqual(context["daily_app_usage_minutes"] as? Int, 35)
        XCTAssertEqual(context["continuous_app_usage_minutes"] as? Int, 15)
        XCTAssertEqual(context["continuous_usage_is_estimated"] as? Bool, true)
        XCTAssertTrue(context["app_switches_last_10_minutes"] is NSNull)
        XCTAssertEqual(context["minutes_since_last_rest"] as? Int, 90)
        XCTAssertEqual(context["local_hour"] as? Int, 10)
        XCTAssertEqual(context["raw_app_names_included"] as? Bool, false)
        XCTAssertEqual(context["full_url_included"] as? Bool, false)
        XCTAssertEqual(context["page_title_included"] as? Bool, false)
        XCTAssertEqual(context["learning_eligible"] as? Bool, false)
        XCTAssertNil(context["bundle_id"])
        XCTAssertNil(context["full_url"])
        XCTAssertNil(context["page_title"])
    }

    func testUnavailableMeasurementsEncodeAsNullInsteadOfZero() async throws {
        let recorder = ManualRestRequestRecorder()
        ManualRestStubURLProtocol.handler = { request in
            recorder.append(request)
            return try Self.successResponse(for: request, origin: "mock")
        }
        let provider = try makeProvider()
        let context = HushAgentDecisionContext(
            measuredAt: "2026-08-09T10:15:00+08:00",
            platform: "ios",
            userProvidedContextLabel: nil,
            dailyAppUsageMinutes: nil,
            continuousAppUsageMinutes: nil,
            continuousUsageIsEstimated: nil,
            appSwitchesLast10Minutes: nil,
            minutesSinceLastRest: nil,
            localHour: 10,
            rawAppNamesIncluded: false,
            fullURLIncluded: false,
            pageTitleIncluded: false,
            learningEligible: false
        )

        let suggestion = try await provider.generateTask(
            context: HushManualRestContext(
                sessionID: "settings-session",
                fatigueType: "unknown",
                userPreference: "surprise",
                availableMinutes: 3,
                source: "settings_agent_test_ios",
                locationTags: [],
                decisionContext: context
            )
        )

        XCTAssertEqual(suggestion.dataOrigin, .mock)
        let body = try XCTUnwrap(recorder.requests.first?.httpBody)
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: body) as? [String: Any]
        )
        let encoded = try XCTUnwrap(
            json["decision_context"] as? [String: Any]
        )
        for key in [
            "user_provided_context_label",
            "daily_app_usage_minutes",
            "continuous_app_usage_minutes",
            "continuous_usage_is_estimated",
            "app_switches_last_10_minutes",
            "minutes_since_last_rest"
        ] {
            XCTAssertTrue(encoded[key] is NSNull, "Expected \(key) to be null")
        }
    }

    func testRejectsMissingCachedAndUnknownOrigin() async throws {
        for origin in [nil, "cached", "fixture"] as [String?] {
            ManualRestStubURLProtocol.handler = { request in
                try Self.successResponse(for: request, origin: origin)
            }
            let provider = try makeProvider()

            do {
                _ = try await provider.generateTask(
                    context: HushManualRestContext(
                        sessionID: "settings-session",
                        fatigueType: "unknown",
                        userPreference: "surprise",
                        availableMinutes: 3,
                        source: "settings_agent_test_ios",
                        locationTags: [],
                        decisionContext: decisionContext()
                    )
                )
                XCTFail("Expected invalid response for \(origin ?? "missing origin")")
            } catch HTTPManualRestTaskProvider.ProviderError.invalidResponse {
                // Expected contract rejection.
            }
        }
    }

    private func makeProvider() throws -> HTTPManualRestTaskProvider {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ManualRestStubURLProtocol.self]
        return try HTTPManualRestTaskProvider(
            baseURLString: "https://agent.example.com",
            session: URLSession(configuration: configuration)
        )
    }

    private func decisionContext() -> HushAgentDecisionContext {
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

    private static func successResponse(
        for request: URLRequest,
        origin: String?
    ) throws -> (HTTPURLResponse, Data) {
        let requestID = try XCTUnwrap(
            request.value(forHTTPHeaderField: "X-Request-ID")
        )
        var headers = [
            "X-Request-ID": requestID,
            "X-Contract-Version": "1.1"
        ]
        if let origin {
            headers["X-Hush-Data-Origin"] = origin
        }
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            )
        )
        let body = Data(
            """
            {"schema_version":"1.1","request_id":"\(requestID)","message":"现在缓一缓。","generated_task":{"title":"望向远处","duration_seconds":60,"steps":["放松肩膀","看向远处"]},"default_quest_id":null,"actions":["start_rest_session","remind_later","dismiss"]}
            """.utf8
        )
        return (response, body)
    }
}

private final class ManualRestRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [URLRequest] = []

    var requests: [URLRequest] {
        lock.withLock { storage }
    }

    func append(_ request: URLRequest) {
        lock.withLock { storage.append(request) }
    }
}

private final class ManualRestStubURLProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(
                self,
                didFailWithError: URLError(.badServerResponse)
            )
            return
        }
        do {
            var recordedRequest = request
            if recordedRequest.httpBody == nil,
               let stream = recordedRequest.httpBodyStream
            {
                stream.open()
                defer { stream.close() }
                var body = Data()
                var buffer = [UInt8](repeating: 0, count: 4_096)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    guard count >= 0 else {
                        throw stream.streamError ?? URLError(.cannotDecodeRawData)
                    }
                    if count == 0 { break }
                    body.append(buffer, count: count)
                }
                recordedRequest.httpBody = body
            }
            let (response, data) = try handler(recordedRequest)
            client?.urlProtocol(
                self,
                didReceive: response,
                cacheStoragePolicy: .notAllowed
            )
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
