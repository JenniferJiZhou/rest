import Foundation

enum UnifiedInboxDataOrigin: String, Sendable {
    case real
    case mock
    case cached
}

struct UnifiedInboxResponse<Value>: Sendable where Value: Sendable {
    let value: Value
    let origin: UnifiedInboxDataOrigin
}

enum UnifiedInboxAPIError: Error {
    case invalidRequest
    case invalidResponse
    case invalidDataOrigin
    case server(InboxErrorResponse)
    case versionConflict(InboxErrorResponse)
}

protocol UnifiedInboxClient: Sendable {
    func syncStatuses() async throws -> UnifiedInboxResponse<[InboxSyncStatusResponse]>
    func listItems(cursor: String?) async throws -> UnifiedInboxResponse<InboxPageResponse>
    func item(id: String) async throws -> UnifiedInboxResponse<InboxItemResponse>
    func acknowledge(id: String, revision: Int) async throws -> UnifiedInboxResponse<InboxItemResponse>
    func draft(id: String) async throws -> UnifiedInboxResponse<InboxDraftResponse>
    func updateDraft(id: String, content: String, version: Int) async throws -> UnifiedInboxResponse<InboxDraftResponse>
    func confirmation(draftID: String) async throws -> UnifiedInboxResponse<InboxConfirmationResponse>
    func send(draftID: String, version: Int, confirmationToken: String, idempotencyKey: String) async throws -> UnifiedInboxResponse<InboxSendResultResponse>
}

final class UnifiedInboxAPIClient: UnifiedInboxClient, @unchecked Sendable {
    private let configuration: UnifiedInboxRuntimeConfiguration
    private let clientVersion: String
    private let appSession: String
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(
        configuration: UnifiedInboxRuntimeConfiguration,
        clientVersion: String = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String ?? "unknown-apple-client",
        sessionConfiguration: URLSessionConfiguration = .ephemeral
    ) {
        self.configuration = configuration
        self.clientVersion = clientVersion
        appSession = UUID().uuidString + UUID().uuidString
        sessionConfiguration.urlCache = nil
        sessionConfiguration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: sessionConfiguration)
    }

    func syncStatuses() async throws -> UnifiedInboxResponse<[InboxSyncStatusResponse]> {
        try await execute(path: ["v1", "inbox", "sync-status"])
    }

    func listItems(cursor: String?) async throws -> UnifiedInboxResponse<InboxPageResponse> {
        var query = [URLQueryItem(name: "limit", value: "100")]
        if let cursor {
            query.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await execute(path: ["v1", "inbox", "items"], query: query)
    }

    func item(id: String) async throws -> UnifiedInboxResponse<InboxItemResponse> {
        try await execute(path: ["v1", "inbox", "items", id])
    }

    func acknowledge(id: String, revision: Int) async throws -> UnifiedInboxResponse<InboxItemResponse> {
        let requestID = UUID().uuidString
        let body = InboxAcknowledgeBody(
            schemaVersion: "1.0",
            requestID: requestID,
            expectedRevision: revision
        )
        return try await execute(
            path: ["v1", "inbox", "items", id],
            pathSuffix: ":acknowledge",
            method: "POST",
            requestID: requestID,
            body: body
        )
    }

    func draft(id: String) async throws -> UnifiedInboxResponse<InboxDraftResponse> {
        try await execute(path: ["v1", "inbox", "drafts", id])
    }

    func updateDraft(id: String, content: String, version: Int) async throws -> UnifiedInboxResponse<InboxDraftResponse> {
        let requestID = UUID().uuidString
        let body = InboxDraftPatchBody(
            schemaVersion: "1.0",
            requestID: requestID,
            content: content,
            contentType: "text",
            expectedVersion: version
        )
        return try await execute(
            path: ["v1", "inbox", "drafts", id],
            method: "PATCH",
            requestID: requestID,
            body: body
        )
    }

    func confirmation(draftID: String) async throws -> UnifiedInboxResponse<InboxConfirmationResponse> {
        try await execute(
            path: ["v1", "inbox", "drafts", draftID, "confirmation"],
            method: "POST"
        )
    }

    func send(
        draftID: String,
        version: Int,
        confirmationToken: String,
        idempotencyKey: String
    ) async throws -> UnifiedInboxResponse<InboxSendResultResponse> {
        let requestID = UUID().uuidString
        let body = InboxSendBody(
            schemaVersion: "1.0",
            requestID: requestID,
            expectedVersion: version,
            confirmationToken: confirmationToken
        )
        return try await execute(
            path: ["v1", "inbox", "drafts", draftID],
            pathSuffix: ":send",
            method: "POST",
            requestID: requestID,
            body: body,
            idempotencyKey: idempotencyKey
        )
    }

    private func execute<Value: Decodable & Sendable>(
        path: [String],
        pathSuffix: String = "",
        query: [URLQueryItem] = [],
        method: String = "GET",
        requestID: String = UUID().uuidString,
        body: (any Encodable)? = nil,
        idempotencyKey: String? = nil
    ) async throws -> UnifiedInboxResponse<Value> {
        let url = try endpoint(
            path: path,
            pathSuffix: pathSuffix,
            query: query
        )
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(configuration.appToken)", forHTTPHeaderField: "Authorization")
        request.setValue(requestID, forHTTPHeaderField: "X-Request-ID")
        request.setValue(clientVersion, forHTTPHeaderField: "X-Client-Version")
        request.setValue("1.0", forHTTPHeaderField: "X-Contract-Version")
        request.setValue(appSession, forHTTPHeaderField: "X-Hush-App-Session")
        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }
        if let body {
            request.httpBody = try encoder.encode(AnyEncodable(body))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)
        guard
            let http = response as? HTTPURLResponse,
            http.value(forHTTPHeaderField: "X-Contract-Version") == "1.0",
            http.value(forHTTPHeaderField: "X-Request-ID") == requestID
        else {
            throw UnifiedInboxAPIError.invalidResponse
        }
        guard
            let rawOrigin = http.value(forHTTPHeaderField: "X-Hush-Data-Origin"),
            let origin = UnifiedInboxDataOrigin(rawValue: rawOrigin)
        else {
            throw UnifiedInboxAPIError.invalidDataOrigin
        }
        guard (200..<300).contains(http.statusCode) else {
            guard let error = try? decoder.decode(InboxErrorResponse.self, from: data) else {
                throw UnifiedInboxAPIError.invalidResponse
            }
            if error.error.code == "INBOX_VERSION_CONFLICT" {
                throw UnifiedInboxAPIError.versionConflict(error)
            }
            throw UnifiedInboxAPIError.server(error)
        }
        return UnifiedInboxResponse(
            value: try decoder.decode(Value.self, from: data),
            origin: origin
        )
    }

    private func endpoint(
        path: [String],
        pathSuffix: String,
        query: [URLQueryItem]
    ) throws -> URL {
        guard var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: false) else {
            throw UnifiedInboxAPIError.invalidRequest
        }
        let base = components.percentEncodedPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        var encodedParts = path.map(Self.encodePathComponent)
        if !pathSuffix.isEmpty, let last = encodedParts.indices.last {
            encodedParts[last] += pathSuffix
        }
        let encoded = encodedParts.joined(separator: "/")
        components.percentEncodedPath = "/" + [base, encoded].filter { !$0.isEmpty }.joined(separator: "/")
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else {
            throw UnifiedInboxAPIError.invalidRequest
        }
        return url
    }

    private static func encodePathComponent(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }
}

private struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        encodeValue = { encoder in
            try value.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try encodeValue(encoder)
    }
}

private struct InboxAcknowledgeBody: Encodable {
    let schemaVersion: String
    let requestID: String
    let expectedRevision: Int

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case requestID = "request_id"
        case expectedRevision = "expected_revision"
    }
}

private struct InboxDraftPatchBody: Encodable {
    let schemaVersion: String
    let requestID: String
    let content: String
    let contentType: String
    let expectedVersion: Int

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case requestID = "request_id"
        case content
        case contentType = "content_type"
        case expectedVersion = "expected_version"
    }
}

private struct InboxSendBody: Encodable {
    let schemaVersion: String
    let requestID: String
    let expectedVersion: Int
    let confirmationToken: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case requestID = "request_id"
        case expectedVersion = "expected_version"
        case confirmationToken = "confirmation_token"
    }
}
