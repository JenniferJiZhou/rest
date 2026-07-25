import Foundation
import XCTest
@testable import Hush

final class UnifiedInboxAPIClientTests: XCTestCase {
    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    func testConfigurationAcceptsPlatformApprovedIntegrationURLs() throws {
        XCTAssertNoThrow(
            try UnifiedInboxRuntimeConfiguration(
                baseURL: XCTUnwrap(URL(string: "http://localhost:3000")),
                appToken: validToken,
                platform: .macOS
            )
        )
        XCTAssertNoThrow(
            try UnifiedInboxRuntimeConfiguration(
                baseURL: XCTUnwrap(URL(string: "http://192.168.1.40:3000")),
                appToken: validToken,
                platform: .iOS
            )
        )
        XCTAssertNoThrow(
            try UnifiedInboxRuntimeConfiguration(
                baseURL: XCTUnwrap(URL(string: "https://inbox.example.com")),
                appToken: validToken,
                platform: .iOS
            )
        )
    }

    func testConfigurationRejectsPublicHTTPAndShortToken() throws {
        XCTAssertThrowsError(
            try UnifiedInboxRuntimeConfiguration(
                baseURL: XCTUnwrap(URL(string: "http://203.0.113.10:3000")),
                appToken: validToken,
                platform: .iOS
            )
        )
        XCTAssertThrowsError(
            try UnifiedInboxRuntimeConfiguration(
                baseURL: XCTUnwrap(URL(string: "https://inbox.example.com")),
                appToken: String(repeating: "a", count: 31),
                platform: .iOS
            )
        )
    }

    func testRequestsUseRequiredHeadersFreshRequestIDsAndStableAppSession() async throws {
        let recorder = RequestRecorder()
        StubURLProtocol.handler = { request in
            recorder.append(request)
            return try Self.successResponse(for: request, body: Data("[]".utf8))
        }
        let client = try makeClient()

        _ = try await client.syncStatuses()
        _ = try await client.syncStatuses()

        let requests = recorder.requests
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer \(validToken)")
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "X-Client-Version"), "9.8.7")
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "X-Contract-Version"), "1.0")
        let firstRequestID = try XCTUnwrap(requests[0].value(forHTTPHeaderField: "X-Request-ID"))
        let secondRequestID = try XCTUnwrap(requests[1].value(forHTTPHeaderField: "X-Request-ID"))
        XCTAssertNotEqual(firstRequestID, secondRequestID)
        XCTAssertNotNil(UUID(uuidString: firstRequestID))
        XCTAssertNotNil(UUID(uuidString: secondRequestID))
        let firstSession = try XCTUnwrap(requests[0].value(forHTTPHeaderField: "X-Hush-App-Session"))
        XCTAssertEqual(firstSession, requests[1].value(forHTTPHeaderField: "X-Hush-App-Session"))
        XCTAssertTrue((32...128).contains(firstSession.count))
    }

    func testUpdateDraftCorrelatesBodyAndHeaderAndEncodesDraftID() async throws {
        let recorder = RequestRecorder()
        StubURLProtocol.handler = { request in
            recorder.append(request)
            return try Self.successResponse(for: request, body: Self.draftJSON)
        }
        let client = try makeClient()

        _ = try await client.updateDraft(id: "draft/with space", content: "Complete reply", version: 4)

        let request = try XCTUnwrap(recorder.requests.first)
        XCTAssertEqual(request.httpMethod, "PATCH")
        let components = try XCTUnwrap(
            URLComponents(
                url: XCTUnwrap(request.url),
                resolvingAgainstBaseURL: false
            )
        )
        XCTAssertEqual(
            components.percentEncodedPath,
            "/v1/inbox/drafts/draft%2Fwith%20space"
        )
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(request.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["request_id"] as? String, request.value(forHTTPHeaderField: "X-Request-ID"))
        XCTAssertEqual(json["schema_version"] as? String, "1.0")
        XCTAssertEqual(json["content"] as? String, "Complete reply")
        XCTAssertEqual(json["content_type"] as? String, "text")
        XCTAssertEqual(json["expected_version"] as? Int, 4)
    }

    func testListItemsBuildsEncodedCursorQueryAndRequestsMaximumPageSize() async throws {
        let recorder = RequestRecorder()
        StubURLProtocol.handler = { request in
            recorder.append(request)
            return try Self.successResponse(
                for: request,
                body: Data(#"{"items":[],"next_cursor":null}"#.utf8)
            )
        }
        let client = try makeClient()

        _ = try await client.listItems(cursor: "next +/=")

        let request = try XCTUnwrap(recorder.requests.first)
        let components = try XCTUnwrap(URLComponents(url: XCTUnwrap(request.url), resolvingAgainstBaseURL: false))
        XCTAssertEqual(
            components.queryItems,
            [URLQueryItem(name: "limit", value: "100"), URLQueryItem(name: "cursor", value: "next +/=")]
        )
    }

    func testSuccessfulResponseRejectsMissingOrUnsupportedOrigin() async throws {
        for origin in [nil, "fixture"] as [String?] {
            StubURLProtocol.handler = { request in
                try Self.successResponse(for: request, origin: origin, body: Data("[]".utf8))
            }
            let client = try makeClient()

            do {
                _ = try await client.syncStatuses()
                XCTFail("Expected invalid data origin for \(origin ?? "missing header")")
            } catch UnifiedInboxAPIError.invalidDataOrigin {
                // Expected protocol rejection.
            }
        }
    }

    func testVersionConflictMapsDistinctly() async throws {
        StubURLProtocol.handler = { request in
            try Self.response(
                for: request,
                statusCode: 409,
                origin: "real",
                body: Data(
                    #"{"schema_version":"1.0","request_id":"server-request","error":{"code":"INBOX_VERSION_CONFLICT","message":"stale revision","retryable":false,"fallback":null,"details":null}}"#.utf8
                )
            )
        }
        let client = try makeClient()

        do {
            _ = try await client.acknowledge(id: "item-1", revision: 3)
            XCTFail("Expected version conflict")
        } catch UnifiedInboxAPIError.versionConflict(let response) {
            XCTAssertEqual(response.error.code, "INBOX_VERSION_CONFLICT")
        }
    }

    func testSendMakesOneAttemptAndIncludesCallerIdempotencyKey() async throws {
        let recorder = RequestRecorder()
        StubURLProtocol.handler = { request in
            recorder.append(request)
            throw URLError(.networkConnectionLost)
        }
        let client = try makeClient()

        do {
            _ = try await client.send(
                draftID: "draft-1",
                version: 5,
                confirmationToken: "confirmation-token-value",
                idempotencyKey: "send-action-idempotency-key"
            )
            XCTFail("Expected transport failure")
        } catch {
            XCTAssertEqual(recorder.requests.count, 1)
            XCTAssertEqual(
                recorder.requests.first?.value(forHTTPHeaderField: "Idempotency-Key"),
                "send-action-idempotency-key"
            )
        }
    }

    func testSendDoesNotFollowRedirectAndReplayRequest() async throws {
        let recorder = RequestRecorder()
        StubURLProtocol.handler = { request in
            recorder.append(request)
            if recorder.requests.count == 1 {
                return try Self.response(
                    for: request,
                    statusCode: 307,
                    origin: "real",
                    additionalHeaders: [
                        "Location": "https://inbox.example.com/redirected-send"
                    ],
                    body: Data()
                )
            }
            return try Self.successResponse(for: request, body: Self.sendResultJSON)
        }
        let client = try makeClient()

        do {
            _ = try await client.send(
                draftID: "draft-1",
                version: 5,
                confirmationToken: "confirmation-token-value",
                idempotencyKey: "send-action-idempotency-key"
            )
        } catch {
            // A blocked redirect is surfaced to the caller as an ambiguous send outcome.
        }

        XCTAssertEqual(recorder.requests.count, 1)
    }

    private var validToken: String {
        "app-token-000000000000000000000000"
    }

    private func makeClient() throws -> UnifiedInboxAPIClient {
        let configuration = try UnifiedInboxRuntimeConfiguration(
            baseURL: XCTUnwrap(URL(string: "https://inbox.example.com")),
            appToken: validToken,
            platform: .iOS
        )
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [StubURLProtocol.self]
        return UnifiedInboxAPIClient(
            configuration: configuration,
            clientVersion: "9.8.7",
            sessionConfiguration: sessionConfiguration
        )
    }

    private static func successResponse(
        for request: URLRequest,
        origin: String? = "real",
        body: Data
    ) throws -> (HTTPURLResponse, Data) {
        try response(for: request, statusCode: 200, origin: origin, body: body)
    }

    private static func response(
        for request: URLRequest,
        statusCode: Int,
        origin: String?,
        additionalHeaders: [String: String] = [:],
        body: Data
    ) throws -> (HTTPURLResponse, Data) {
        var headers = [
            "X-Request-ID": request.value(forHTTPHeaderField: "X-Request-ID") ?? "missing",
            "X-Contract-Version": "1.0"
        ]
        if let origin {
            headers["X-Hush-Data-Origin"] = origin
        }
        headers.merge(additionalHeaders) { _, new in new }
        let response = try XCTUnwrap(
            HTTPURLResponse(
                url: XCTUnwrap(request.url),
                statusCode: statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            )
        )
        return (response, body)
    }

    private static let draftJSON = Data(
        #"{"id":"draft-1","inbox_item_id":"item-1","content":"Complete reply","content_type":"text","version":5,"origin":"user","status":"edited","provider_draft_id":null,"created_at":"2026-07-25T00:00:00Z","updated_at":"2026-07-25T00:01:00Z"}"#.utf8
    )

    private static let sendResultJSON = Data(
        #"{"draft_id":"draft-1","provider":"feishu","status":"sent","provider_message_id":"provider-message","sent_at":"2026-07-25T00:02:00Z"}"#.utf8
    )
}

private final class RequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [URLRequest] = []

    var requests: [URLRequest] {
        lock.withLock { storage }
    }

    func append(_ request: URLRequest) {
        lock.withLock { storage.append(request) }
    }
}

private final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
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
            if (300..<400).contains(response.statusCode),
               let location = response.value(forHTTPHeaderField: "Location"),
               let redirectURL = URL(string: location)
            {
                var redirectRequest = recordedRequest
                redirectRequest.url = redirectURL
                client?.urlProtocol(
                    self,
                    wasRedirectedTo: redirectRequest,
                    redirectResponse: response
                )
                return
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
