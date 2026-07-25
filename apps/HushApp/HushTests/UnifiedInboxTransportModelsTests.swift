import XCTest
@testable import Hush

final class UnifiedInboxTransportModelsTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testDecodesEnrichedItemFixture() throws {
        let item = try decodeFixture("inbox-item-enriched-demo", as: InboxItemResponse.self)

        XCTAssertEqual(item.provider, .outlook)
        XCTAssertEqual(item.revision, 1)
        XCTAssertEqual(item.conversationID, "conversation-demo-001")
        XCTAssertNil(item.coverage.note)
        XCTAssertTrue(item.needsReply ?? false)
        XCTAssertEqual(item.replyTargets.count, 1)
        XCTAssertFalse(item.replyTargets.first?.reason.isEmpty ?? true)
    }

    func testDecodesGroupDigestFixture() throws {
        let item = try decodeFixture("inbox-group-digest-demo", as: InboxItemResponse.self)

        XCTAssertEqual(item.provider, .dingtalk)
        XCTAssertEqual(item.revision, 3)
        XCTAssertEqual(item.itemKind, .conversationDigest)
        XCTAssertNil(item.sender)
        XCTAssertNil(item.senderRef)
        XCTAssertNil(item.content)
        XCTAssertEqual(item.messageCount, 18)
        XCTAssertNotNil(item.sealedAt)
        XCTAssertNil(item.acknowledgedAt)
        XCTAssertEqual(item.replyTargets.count, 1)
    }

    func testDecodesEditedDraftFixture() throws {
        let draft = try decodeFixture("inbox-draft-edited-demo", as: InboxDraftResponse.self)

        XCTAssertEqual(draft.version, 2)
        XCTAssertEqual(draft.origin, .user)
        XCTAssertEqual(draft.status, .edited)
        XCTAssertEqual(draft.contentType, .text)
        XCTAssertNil(draft.providerDraftID)
    }

    func testDecodesPageWithNoNextCursor() throws {
        let page = try decoder.decode(
            InboxPageResponse.self,
            from: Data("{\"items\":[],\"next_cursor\":null}".utf8)
        )

        XCTAssertTrue(page.items.isEmpty)
        XCTAssertNil(page.nextCursor)
    }

    private func decodeFixture<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
        let bundle = Bundle(for: UnifiedInboxTransportModelsTests.self)
        let url = try XCTUnwrap(bundle.url(forResource: name, withExtension: "json"))
        return try decoder.decode(T.self, from: Data(contentsOf: url))
    }
}
