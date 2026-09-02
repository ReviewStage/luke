import Foundation
import XCTest

@testable import LukeKit

private let serviceURL = URL(string: "https://tryluke.dev")!

private func makeConversationResponse(
    body: [String: Any],
    status: Int = 200
) -> (Data, URLResponse) {
    let data = try! JSONSerialization.data(withJSONObject: body)
    let response = HTTPURLResponse(
        url: serviceURL.appendingPathComponent("api/sessions/messages"),
        statusCode: status,
        httpVersion: nil,
        headerFields: nil
    )!
    return (data, response)
}

// MARK: - ConversationMessage parsing

final class ConversationMessageTests: XCTestCase {
    func testRequiredFieldsMissing() {
        XCTAssertNil(ConversationMessage(json: [:]))
        XCTAssertNil(ConversationMessage(json: ["id": "m1", "author": "agent"]))
        XCTAssertNil(ConversationMessage(json: ["id": "m1", "text": "words"]))
        XCTAssertNil(ConversationMessage(json: ["id": "", "author": "agent", "text": "words"]))
        XCTAssertNil(ConversationMessage(json: ["id": "m1", "author": "agent", "text": ""]))
    }

    func testUnknownAuthorIsDroppedRatherThanGuessed() {
        XCTAssertNil(ConversationMessage(json: ["id": "m1", "author": "tool", "text": "output"]))
    }

    func testAttributedMessageParsesWhole() {
        let message = ConversationMessage(json: [
            "id": "m1",
            "author": "user",
            "text": "  words keep their own shape  ",
            "receivedAt": 1_756_700_000_000.0,
        ])
        XCTAssertNotNil(message)
        XCTAssertEqual(message?.author, .user)
        // The words travel exactly as written: rendering never trims them.
        XCTAssertEqual(message?.text, "  words keep their own shape  ")
        XCTAssertEqual(message?.receivedAt, Date(timeIntervalSince1970: 1_756_700_000))
    }
}

// MARK: - RosterSession advertisement

final class RosterSessionConversationTests: XCTestCase {
    func testCanReadConversationDefaultsFalse() {
        let session = RosterSession(json: [
            "providerId": "devin",
            "sessionId": "sess-1",
            "title": "Task",
            "status": "waiting",
        ])
        XCTAssertEqual(session?.canReadConversation, false)
    }

    func testCanReadConversationParses() {
        let session = RosterSession(json: [
            "providerId": "conductor",
            "sessionId": "sess-1",
            "title": "Task",
            "status": "waiting",
            "canReadConversation": true,
        ])
        XCTAssertEqual(session?.canReadConversation, true)
    }
}

// MARK: - ConversationClient

final class ConversationClientTests: XCTestCase {
    func testReadBuildsTheDocumentedQuery() async throws {
        let stub = StubHTTPClient { request in
            let components = URLComponents(
                url: request.url!, resolvingAgainstBaseURL: false
            )!
            XCTAssertTrue(components.path.hasSuffix("api/sessions/messages"))
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "Authorization"), "Bearer token-1"
            )
            let query = Dictionary(
                uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) }
            )
            XCTAssertEqual(query["providerId"], "conductor")
            XCTAssertEqual(query["providerSessionId"], "sess-1")
            XCTAssertEqual(query["after"], "m-cursor")
            return makeConversationResponse(body: ["messages": [], "hasMore": false])
        }
        let client = ConversationClient(serviceURL: serviceURL, http: stub)
        let answer = try await client.read(
            accessToken: "token-1",
            providerId: "conductor",
            providerSessionId: "sess-1",
            position: .after("m-cursor")
        )
        XCTAssertEqual(answer.messages, [])
        XCTAssertNil(answer.lastMessageId)
        XCTAssertFalse(answer.hasMore)
        XCTAssertNil(answer.firstOffset)
        XCTAssertFalse(answer.hasOlder)
    }

    func testTheLatestPositionSendsNoCursorAtAll() async throws {
        let stub = StubHTTPClient { request in
            let components = URLComponents(
                url: request.url!, resolvingAgainstBaseURL: false
            )!
            let names = (components.queryItems ?? []).map(\.name)
            XCTAssertFalse(names.contains("after"))
            XCTAssertFalse(names.contains("beforeOffset"))
            return makeConversationResponse(body: ["messages": [], "hasMore": false])
        }
        let client = ConversationClient(serviceURL: serviceURL, http: stub)
        _ = try await client.read(
            accessToken: "token-1",
            providerId: "conductor",
            providerSessionId: "sess-1"
        )
    }

    func testAHistoryPositionRidesAsAnOffsetAlone() async throws {
        let stub = StubHTTPClient { request in
            let components = URLComponents(
                url: request.url!, resolvingAgainstBaseURL: false
            )!
            let query = Dictionary(
                uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) }
            )
            XCTAssertEqual(query["beforeOffset"], "240")
            XCTAssertNil(query["after"])
            return makeConversationResponse(body: [
                "messages": [],
                "hasMore": false,
                "firstOffset": 140,
                "hasOlder": true,
            ])
        }
        let client = ConversationClient(serviceURL: serviceURL, http: stub)
        let answer = try await client.read(
            accessToken: "token-1",
            providerId: "conductor",
            providerSessionId: "sess-1",
            position: .before(240)
        )
        XCTAssertEqual(answer.firstOffset, 140)
        XCTAssertTrue(answer.hasOlder)
        XCTAssertNil(answer.lastMessageId)
    }

    func testReadParsesThePageAndSkipsMalformedEntries() async throws {
        let stub = StubHTTPClient { _ in
            makeConversationResponse(body: [
                "messages": [
                    ["id": "m1", "author": "user", "text": "Fix the test"],
                    ["id": "m2", "author": "agent", "text": "Done.", "receivedAt": 1_000.0],
                    ["id": "m3", "author": "tool", "text": "dropped"],
                    ["id": "m4"],
                ],
                "lastMessageId": "m9",
                "hasMore": true,
            ])
        }
        let client = ConversationClient(serviceURL: serviceURL, http: stub)
        let answer = try await client.read(
            accessToken: "token-1",
            providerId: "conductor",
            providerSessionId: "sess-1"
        )
        XCTAssertEqual(answer.messages.map(\.id), ["m1", "m2"])
        XCTAssertEqual(answer.messages.first?.author, .user)
        XCTAssertEqual(answer.messages.last?.text, "Done.")
        XCTAssertEqual(answer.lastMessageId, "m9")
        XCTAssertTrue(answer.hasMore)
    }

    func testUnauthorizedThrowsItsOwnSignal() async {
        let stub = StubHTTPClient { _ in
            makeConversationResponse(body: [:], status: 401)
        }
        let client = ConversationClient(serviceURL: serviceURL, http: stub)
        do {
            _ = try await client.read(
                accessToken: "expired",
                providerId: "conductor",
                providerSessionId: "sess-1"
            )
            XCTFail("expected unauthorized")
        } catch {
            XCTAssertEqual(error as? ConversationClientError, .unauthorized)
        }
    }

    func testServerErrorCarriesTheStatus() async {
        let stub = StubHTTPClient { _ in
            makeConversationResponse(body: [:], status: 502)
        }
        let client = ConversationClient(serviceURL: serviceURL, http: stub)
        do {
            _ = try await client.read(
                accessToken: "token-1",
                providerId: "conductor",
                providerSessionId: "sess-1"
            )
            XCTFail("expected serverError")
        } catch {
            XCTAssertEqual(error as? ConversationClientError, .serverError(status: 502))
        }
    }

    func testAnAnswerWithoutItsEnvelopeIsInvalid() async {
        let stub = StubHTTPClient { _ in
            makeConversationResponse(body: ["messages": []])
        }
        let client = ConversationClient(serviceURL: serviceURL, http: stub)
        do {
            _ = try await client.read(
                accessToken: "token-1",
                providerId: "conductor",
                providerSessionId: "sess-1"
            )
            XCTFail("expected invalidResponse")
        } catch {
            XCTAssertEqual(error as? ConversationClientError, .invalidResponse)
        }
    }
}
