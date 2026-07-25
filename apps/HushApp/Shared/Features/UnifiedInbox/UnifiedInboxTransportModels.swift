import Foundation

enum InboxProviderResponse: String, Codable, Sendable {
    case feishu
    case dingtalk
    case outlook
    case qqMail = "qq_mail"
}

enum InboxPriorityResponse: String, Codable, Sendable {
    case urgent
    case normal
    case low
    case uncertain
}

enum InboxItemSyncStatusResponse: String, Codable, Sendable {
    case pending
    case ready
    case failed
}

enum InboxSyncStateResponse: String, Codable, Sendable {
    case ready
    case degraded
    case unavailable
    case unknown
}

enum InboxDraftStatusResponse: String, Codable, Sendable {
    case generating
    case ready
    case edited
    case sending
    case sent
    case failed
    case unknown
}

enum InboxDraftOriginResponse: String, Codable, Sendable {
    case ai
    case user
}

enum InboxSendStatusResponse: String, Codable, Sendable {
    case sent
    case failed
    case unknown
}

enum InboxContentTypeResponse: String, Codable, Sendable {
    case text
    case html
}

enum InboxCoverageSourceResponse: String, Codable, Sendable {
    case officialAPI = "official_api"
    case imap
    case browserFallback = "browser_fallback"
}

enum InboxConversationTypeResponse: String, Codable, Sendable {
    case direct
    case group
}

enum InboxItemKindResponse: String, Codable, Sendable {
    case message
    case conversationDigest = "conversation_digest"
}

struct InboxCoverageResponse: Codable, Sendable {
    let source: InboxCoverageSourceResponse
    let complete: Bool
    let note: String?
}

struct InboxReplyTargetResponse: Codable, Sendable {
    let targetID: String
    let displayName: String
    let reason: String

    enum CodingKeys: String, CodingKey {
        case targetID = "target_id"
        case displayName = "display_name"
        case reason
    }
}

struct InboxItemResponse: Codable, Sendable {
    let id: String
    let provider: InboxProviderResponse
    let accountID: String
    let conversationID: String?
    let conversationType: InboxConversationTypeResponse
    let conversationName: String
    let providerMessageID: String
    let sender: String?
    let senderRef: String?
    let recipients: [String]
    let subject: String?
    let content: String?
    let receivedAt: String
    let coverage: InboxCoverageResponse
    let itemKind: InboxItemKindResponse
    let revision: Int
    let messageCount: Int
    let windowStartedAt: String
    let windowEndedAt: String
    let sealedAt: String?
    let acknowledgedAt: String?
    let summary: String?
    let importantPoints: [String]
    let todos: [String]
    let priority: InboxPriorityResponse
    let needsReply: Bool?
    let replyTargets: [InboxReplyTargetResponse]
    let draftID: String?
    let syncStatus: InboxItemSyncStatusResponse

    enum CodingKeys: String, CodingKey {
        case id
        case provider
        case accountID = "account_id"
        case conversationID = "conversation_id"
        case conversationType = "conversation_type"
        case conversationName = "conversation_name"
        case providerMessageID = "provider_message_id"
        case sender
        case senderRef = "sender_ref"
        case recipients
        case subject
        case content
        case receivedAt = "received_at"
        case coverage
        case itemKind = "item_kind"
        case revision
        case messageCount = "message_count"
        case windowStartedAt = "window_started_at"
        case windowEndedAt = "window_ended_at"
        case sealedAt = "sealed_at"
        case acknowledgedAt = "acknowledged_at"
        case summary
        case importantPoints = "important_points"
        case todos
        case priority
        case needsReply = "needs_reply"
        case replyTargets = "reply_targets"
        case draftID = "draft_id"
        case syncStatus = "sync_status"
    }
}

struct InboxDraftResponse: Codable, Sendable {
    let id: String
    let inboxItemID: String
    let content: String
    let contentType: InboxContentTypeResponse
    let version: Int
    let origin: InboxDraftOriginResponse
    let status: InboxDraftStatusResponse
    let providerDraftID: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case inboxItemID = "inbox_item_id"
        case content
        case contentType = "content_type"
        case version
        case origin
        case status
        case providerDraftID = "provider_draft_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct InboxSyncStatusResponse: Codable, Sendable {
    let provider: InboxProviderResponse
    let accountID: String
    let status: InboxSyncStateResponse
    let checkpoint: String?
    let lastSyncedAt: String?
    let lastError: String?
    let coverage: InboxCoverageResponse

    enum CodingKeys: String, CodingKey {
        case provider
        case accountID = "account_id"
        case status
        case checkpoint
        case lastSyncedAt = "last_synced_at"
        case lastError = "last_error"
        case coverage
    }
}

struct InboxConfirmationResponse: Codable, Sendable {
    let confirmationToken: String
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case confirmationToken = "confirmation_token"
        case expiresAt = "expires_at"
    }
}

struct InboxSendResultResponse: Codable, Sendable {
    let draftID: String
    let provider: InboxProviderResponse
    let status: InboxSendStatusResponse
    let providerMessageID: String?
    let sentAt: String?

    enum CodingKeys: String, CodingKey {
        case draftID = "draft_id"
        case provider
        case status
        case providerMessageID = "provider_message_id"
        case sentAt = "sent_at"
    }
}

struct InboxPageResponse: Codable, Sendable {
    let items: [InboxItemResponse]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items
        case nextCursor = "next_cursor"
    }
}

struct InboxErrorResponse: Codable, Sendable {
    let schemaVersion: String
    let requestID: String
    let error: InboxErrorDetailsResponse

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case requestID = "request_id"
        case error
    }
}

struct InboxErrorDetailsResponse: Codable, Sendable {
    let code: String
    let message: String
    let retryable: Bool
    let fallback: String?
    let details: [String: InboxJSONValue]?
}

indirect enum InboxJSONValue: Codable, Sendable {
    case array([InboxJSONValue])
    case bool(Bool)
    case number(Double)
    case object([String: InboxJSONValue])
    case string(String)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([InboxJSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: InboxJSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch self {
        case .array(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}
