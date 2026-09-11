import Foundation
import XCTest

@testable import LukeKit

/// The read answers from D2, decoded as the bytes `packages/hosted/fixtures/
/// reads/` holds, and the client that fetches them, run against a stub that
/// answers those same bytes.
final class ConversationReadsFixtureTests: XCTestCase {
    private let decoder = JSONDecoder()

    private enum Fixture {
        static let messages = "conversation-messages-answer.json"
        static let events = "conversation-events-answer.json"
        static let turns = "brain-turns-answer.json"
        static let changesRequest = "changes-request.json"
        static let changesAnswer = "changes-answer.json"
    }

    private static let main = "3c000000-0000-4000-8000-000000000001"
    private static let observed = "3c000000-0000-4000-8000-000000000002"
    private static let fixtureSession = SessionIdentity(
        providerId: "conductor", providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50"
    )

    private func fixture<Answer: Decodable>(_ name: String, as _: Answer.Type) throws -> Answer {
        try decoder.decode(Answer.self, from: RepositoryFixtures.data(RepositoryFixtures.reads, name))
    }

    func testMessagesAnswerDecodesToTheViewsGroups() throws {
        let answer = try fixture(Fixture.messages, as: ConversationMessagesAnswer.self)
        XCTAssertEqual(
            answer.conversations,
            [
                ConversationReadConversation(id: Self.main, source: .main),
                ConversationReadConversation(id: Self.observed, source: .observed(Self.fixtureSession)),
            ]
        )
        XCTAssertFalse(answer.hasMore)
        XCTAssertEqual(answer.groups.count, 2)

        let ask = answer.groups[0]
        XCTAssertEqual(ask.turnId, "1a000000-0000-4000-8000-000000000001")
        XCTAssertEqual(ask.conversationId, Self.main)
        XCTAssertEqual(ask.source, .main)
        XCTAssertEqual(ask.turn?.origin, .typed)
        XCTAssertEqual(ask.turn?.status, .settled)
        XCTAssertEqual(ask.turn?.queuedAt, Date(timeIntervalSince1970: 1_757_505_600))
        XCTAssertEqual(ask.messages.map(\.seq), [1, 2])
        XCTAssertEqual(ask.messages[0].message.attribution, .user(.typedAsk))
        XCTAssertEqual(ask.messages[0].tools, [])
        XCTAssertEqual(
            ask.messages[1].tools,
            [
                .action(
                    ToolPartIdentity(
                        toolCallId: "call_1a0000000000000001",
                        toolName: "send_session_message",
                        state: .outputAvailable
                    ),
                    outcome: .accepted
                ),
            ]
        )

        let briefing = answer.groups[1]
        XCTAssertEqual(briefing.source, .observed(Self.fixtureSession))
        XCTAssertEqual(briefing.turn?.origin, .rosterDiff)
        XCTAssertEqual(briefing.messages.map(\.seq), [32])
        XCTAssertEqual(
            briefing.messages[0].tools,
            [
                .announce(
                    ToolPartIdentity(
                        toolCallId: "call_3a0000000000000002", toolName: "announce", state: .outputAvailable
                    ),
                    unspoken: false
                ),
            ]
        )
    }

    func testEventsAnswerDecodesEveryKindItCarries() throws {
        let answer = try fixture(Fixture.events, as: ConversationEventsAnswer.self)
        XCTAssertEqual(answer.events.map(\.kind), [.speechOffered, .speechClaimed, .rating])
        XCTAssertEqual(answer.events.map(\.seq), [1, 2, 3])
        XCTAssertEqual(Set(answer.events.map(\.messageId)), ["2b000000-0000-4000-8000-000000000032"])
        XCTAssertNil(answer.events[0].deviceId)
        XCTAssertEqual(answer.events[1].deviceId, "7c9e6679-7425-40de-944b-e07fc1f90ae7")
        XCTAssertEqual(answer.events[2].payload, .object(["rating": .string("up")]))
        XCTAssertFalse(answer.hasMore)
    }

    func testTurnsAnswerDecodesEachTurnWithItsCursor() throws {
        let answer = try fixture(Fixture.turns, as: BrainTurnsAnswer.self)
        XCTAssertEqual(answer.turns.map(\.turn.origin), [.typed, .rosterDiff])
        XCTAssertEqual(answer.turns.map(\.conversationId), [Self.main, Self.observed])
        XCTAssertEqual(answer.turns[0].model, "gpt-5")
        XCTAssertNil(answer.turns[1].model)
        XCTAssertEqual(answer.turns.last?.cursor, answer.next)
        XCTAssertFalse(answer.hasMore)
    }

    func testChangesAnswerHeadsAreTheOtherAnswersCursors() throws {
        let changes = try fixture(Fixture.changesAnswer, as: ChangesAnswer.self)
        let messages = try fixture(Fixture.messages, as: ConversationMessagesAnswer.self)
        let events = try fixture(Fixture.events, as: ConversationEventsAnswer.self)
        let turns = try fixture(Fixture.turns, as: BrainTurnsAnswer.self)
        XCTAssertTrue(changes.seen)
        XCTAssertEqual(changes.messages, messages.next)
        XCTAssertEqual(changes.events, events.next)
        XCTAssertEqual(changes.turns, turns.next)
        XCTAssertEqual(changes.rosterObservedAt, Date(timeIntervalSince1970: 1_757_505_780))
    }

    func testAnUnknownEnumMemberRefusesTheAnswer() throws {
        var json = try RepositoryFixtures.json(RepositoryFixtures.reads, Fixture.turns)
        var turns = try XCTUnwrap(json["turns"] as? [[String: Any]])
        turns[0]["status"] = "paused"
        json["turns"] = turns
        let bytes = try JSONSerialization.data(withJSONObject: json)
        XCTAssertThrowsError(try decoder.decode(BrainTurnsAnswer.self, from: bytes))
    }

    func testAGroupWithNoRowsIsRefused() throws {
        var json = try RepositoryFixtures.json(RepositoryFixtures.reads, Fixture.messages)
        var groups = try XCTUnwrap(json["groups"] as? [[String: Any]])
        groups[0]["messages"] = []
        json["groups"] = groups
        let bytes = try JSONSerialization.data(withJSONObject: json)
        XCTAssertThrowsError(try decoder.decode(ConversationMessagesAnswer.self, from: bytes))
    }

    // MARK: - The client

    private final class StubHTTP: HTTPClient, @unchecked Sendable {
        var requests: [URLRequest] = []
        var status = 200
        var body = Data()

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            requests.append(request)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil
            )!
            return (body, response)
        }
    }

    private let serviceURL = URL(string: "https://example.invalid")!

    func testMessagesReadCarriesTheCursorAndPageBound() async throws {
        let http = StubHTTP()
        http.body = try RepositoryFixtures.data(RepositoryFixtures.reads, Fixture.messages)
        let client = ConversationReadClient(serviceURL: serviceURL, http: http)
        let answer = try await client.messages(after: "abc", accessToken: "token")
        XCTAssertEqual(answer.groups.count, 2)
        let request = try XCTUnwrap(http.requests.first)
        let components = try XCTUnwrap(URLComponents(url: request.url!, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.path, "/api/conversation/messages")
        XCTAssertEqual(
            Set(components.queryItems ?? []),
            [URLQueryItem(name: "limit", value: "200"), URLQueryItem(name: "after", value: "abc")]
        )
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
        XCTAssertEqual(request.httpMethod, "GET")
    }

    func testAFirstReadCarriesNoCursor() async throws {
        let http = StubHTTP()
        http.body = try RepositoryFixtures.data(RepositoryFixtures.reads, Fixture.events)
        let client = ConversationReadClient(serviceURL: serviceURL, http: http)
        _ = try await client.events(after: nil, accessToken: "token")
        let components = try XCTUnwrap(
            URLComponents(url: http.requests[0].url!, resolvingAgainstBaseURL: false)
        )
        XCTAssertEqual(components.path, "/api/conversation/events")
        XCTAssertEqual(components.queryItems?.map(\.name), ["limit"])
    }

    func testChangesPostsTheRequestShapeTheFixtureHolds() async throws {
        let http = StubHTTP()
        http.body = try RepositoryFixtures.data(RepositoryFixtures.reads, Fixture.changesAnswer)
        let client = ConversationReadClient(serviceURL: serviceURL, http: http)
        let fixture = try RepositoryFixtures.json(RepositoryFixtures.reads, Fixture.changesRequest)
        let deviceId = try XCTUnwrap(fixture["deviceId"] as? String)
        let activeUntil = Date(timeIntervalSince1970: 1_757_505_900)
        let answer = try await client.changes(deviceId: deviceId, activeUntil: activeUntil, accessToken: "token")
        XCTAssertTrue(answer.seen)
        let request = try XCTUnwrap(http.requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/changes")
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any]
        )
        XCTAssertEqual(body["deviceId"] as? String, deviceId)
        XCTAssertEqual(body["activeUntil"] as? Int, fixture["activeUntil"] as? Int)
        XCTAssertTrue(Set(body.keys).isSubset(of: Set(fixture.keys)))
    }

    func testAnUnreadableRowRefusalNamesTheRow() async throws {
        let http = StubHTTP()
        http.status = 500
        http.body = Data(
            #"{"error":"unreadable-row","unreadableRow":{"conversationId":"3c000000-0000-4000-8000-000000000001","seq":7}}"#
                .utf8
        )
        let client = ConversationReadClient(serviceURL: serviceURL, http: http)
        do {
            _ = try await client.messages(after: nil, accessToken: "token")
            XCTFail("a refused page")
        } catch let error as ConversationReadError {
            XCTAssertEqual(
                error,
                .unreadableRow(UnreadableRow(conversationId: "3c000000-0000-4000-8000-000000000001", seq: 7))
            )
        }
    }

    func testAnUnreadableRowRefusalThatNamesNoRowIsAServerError() async throws {
        let http = StubHTTP()
        http.status = 500
        http.body = Data(#"{"error":"unreadable-row"}"#.utf8)
        let client = ConversationReadClient(serviceURL: serviceURL, http: http)
        do {
            _ = try await client.messages(after: nil, accessToken: "token")
            XCTFail("a refused page")
        } catch let error as ConversationReadError {
            XCTAssertEqual(error, .serverError(status: 500, apiError: .unreadableRow))
        }
    }

    func testAnUnauthorizedAnswerSignalsForTheRetry() async throws {
        let http = StubHTTP()
        http.status = 401
        let client = ConversationReadClient(serviceURL: serviceURL, http: http)
        do {
            _ = try await client.turns(after: nil, accessToken: "token")
            XCTFail("a refused read")
        } catch let error as ConversationReadError {
            XCTAssertEqual(error, .unauthorized)
            XCTAssertTrue(error.isUnauthorized)
        }
    }

    func testAMalformedAnswerIsDiscarded() async throws {
        let http = StubHTTP()
        http.body = Data(#"{"groups":[]}"#.utf8)
        let client = ConversationReadClient(serviceURL: serviceURL, http: http)
        do {
            _ = try await client.messages(after: nil, accessToken: "token")
            XCTFail("a refused answer")
        } catch let error as ConversationReadError {
            XCTAssertEqual(error, .invalidResponse)
        }
    }
}
