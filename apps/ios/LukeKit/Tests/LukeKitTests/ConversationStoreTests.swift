import Foundation
import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

@testable import LukeKit

/// What the Conversation screen observes of the store's reads: a thread that
/// opens on the tail and reads forward from the head, older turns that land
/// under it one page at a time only while older turns stand, a read that
/// did not land leaving the thread as it was, and a tapped message the tail
/// does not hold found by reading back through history.
@MainActor
final class ConversationStoreTests: XCTestCase {
    private static let main = "3c000000-0000-4000-8000-000000000001"

    /// Answers each path with the bodies queued for it, in order, the last one standing.
    private final class RoutedHTTP: HTTPClient, @unchecked Sendable {
        var bodies: [String: [(status: Int, body: Data)]] = [:]
        private(set) var paths: [String] = []
        private(set) var queries: [[URLQueryItem]] = []

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            let components = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
            paths.append(components.path)
            queries.append(components.queryItems ?? [])
            var queue = bodies[components.path] ?? []
            let answer = queue.count > 1 ? queue.removeFirst() : queue.first ?? (status: 404, body: Data())
            bodies[components.path] = queue
            let response = HTTPURLResponse(
                url: request.url!, statusCode: answer.status, httpVersion: nil, headerFields: nil
            )!
            return (answer.body, response)
        }
    }

    private final class Tokens: AccountTokenProviding {
        var accountEmail: String? = "dev@example.com"
        func validAccessToken() async throws -> String { "token" }
        func refreshAccessToken() async throws -> String { "token" }
    }

    private static let historyPath = "/api/conversation/history"
    private static let messagesPath = "/api/conversation/messages"

    private func group(_ turnId: String, messageId: String, at: TimeInterval) -> [String: Any] {
        [
            "turnId": turnId,
            "conversationId": Self.main,
            "source": ["kind": "main"],
            "messages": [
                [
                    "message": ["id": messageId, "role": "assistant", "metadata": ["author": "brain"], "parts": [["type": "text", "text": "words"]]],
                    "seq": Int(at),
                    "createdAt": Int(at * 1000),
                    "placedAt": Int(at * 1000),
                    "tools": [],
                ],
            ],
        ]
    }

    private func history(groups: [[String: Any]], older: String, hasOlder: Bool, next: String) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            "conversations": [["id": Self.main, "kind": "main", "openedAt": 1_757_505_000_000]],
            "groups": groups,
            "older": older,
            "hasOlder": hasOlder,
            "next": next,
        ])
    }

    private func messages(groups: [[String: Any]], next: String) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            "conversations": [["id": Self.main, "kind": "main", "openedAt": 1_757_505_000_000]],
            "groups": groups,
            "next": next,
            "hasMore": false,
        ])
    }

    private func makeStore(_ http: RoutedHTTP) -> ConversationStore {
        ConversationStore(
            client: ConversationReadClient(serviceURL: URL(string: "https://example.invalid")!, http: http),
            deviceId: { nil }
        )
    }

    func testTheFirstPollOpensOnTheTailAndReadsForwardFromItsHead() async throws {
        let http = RoutedHTTP()
        http.bodies[Self.historyPath] = [(200, history(groups: [group("t9", messageId: "m9", at: 9)], older: "h9", hasOlder: true, next: "c9"))]
        http.bodies[Self.messagesPath] = [(200, messages(groups: [group("t10", messageId: "m10", at: 10)], next: "c10"))]
        let store = makeStore(http)
        await store.poll(account: Tokens())
        XCTAssertTrue(store.opened)
        XCTAssertNil(store.failure)
        XCTAssertEqual(store.groups.map(\.turnId), ["t9", "t10"])
        XCTAssertTrue(store.hasOlder)
        XCTAssertEqual(http.paths.prefix(2), [Self.historyPath, Self.messagesPath])
        XCTAssertEqual(http.queries[1], [URLQueryItem(name: "limit", value: "200"), URLQueryItem(name: "after", value: "c9")])
    }

    func testLoadingOlderLandsThePageBeforeTheTailAndStopsWhereHistoryEnds() async throws {
        let http = RoutedHTTP()
        http.bodies[Self.historyPath] = [
            (200, history(groups: [group("t9", messageId: "m9", at: 9)], older: "h9", hasOlder: true, next: "c9")),
            (200, history(groups: [group("t8", messageId: "m8", at: 8)], older: "h8", hasOlder: false, next: "c9")),
        ]
        http.bodies[Self.messagesPath] = [(200, messages(groups: [], next: "c9"))]
        let store = makeStore(http)
        let tokens = Tokens()
        await store.poll(account: tokens)
        let landed = await store.loadOlder(account: tokens)
        XCTAssertTrue(landed)
        XCTAssertEqual(store.groups.map(\.turnId), ["t8", "t9"])
        XCTAssertFalse(store.hasOlder)
        XCTAssertEqual(http.queries[2], [URLQueryItem(name: "limit", value: "200"), URLQueryItem(name: "before", value: "h9")])
        let again = await store.loadOlder(account: tokens)
        XCTAssertFalse(again)
        XCTAssertEqual(http.paths.filter { $0 == Self.historyPath }.count, 2)
    }

    func testAnOlderReadThatDidNotLandLeavesTheThreadAndHistoryStanding() async throws {
        let http = RoutedHTTP()
        http.bodies[Self.historyPath] = [
            (200, history(groups: [group("t9", messageId: "m9", at: 9)], older: "h9", hasOlder: true, next: "c9")),
            (503, Data()),
        ]
        http.bodies[Self.messagesPath] = [(200, messages(groups: [], next: "c9"))]
        let store = makeStore(http)
        let tokens = Tokens()
        await store.poll(account: tokens)
        let landed = await store.loadOlder(account: tokens)
        XCTAssertFalse(landed)
        XCTAssertEqual(store.groups.map(\.turnId), ["t9"])
        XCTAssertTrue(store.hasOlder)
        XCTAssertNil(store.failure)
        XCTAssertFalse(store.loadingOlder)
    }

    func testATappedMessageBehindTheTailIsFoundByReadingBackThroughHistory() async throws {
        let http = RoutedHTTP()
        http.bodies[Self.historyPath] = [
            (200, history(groups: [group("t9", messageId: "m9", at: 9)], older: "h9", hasOlder: true, next: "c9")),
            (200, history(groups: [group("t8", messageId: "m8", at: 8)], older: "h8", hasOlder: true, next: "c9")),
            (200, history(groups: [group("t7", messageId: "m7", at: 7)], older: "h7", hasOlder: false, next: "c9")),
        ]
        http.bodies[Self.messagesPath] = [(200, messages(groups: [], next: "c9"))]
        let store = makeStore(http)
        store.open(at: "m7")
        await store.poll(account: Tokens())
        XCTAssertEqual(store.groups.map(\.turnId), ["t7", "t8", "t9"])
        guard case .found = store.opening else { return XCTFail("expected the message found, got \(String(describing: store.opening))") }
    }

    func testATappedMessageNowhereInHistoryIsMissingOnlyOnceHistoryEnds() async throws {
        let http = RoutedHTTP()
        http.bodies[Self.historyPath] = [
            (200, history(groups: [group("t9", messageId: "m9", at: 9)], older: "h9", hasOlder: true, next: "c9")),
            (200, history(groups: [group("t8", messageId: "m8", at: 8)], older: "h8", hasOlder: false, next: "c9")),
        ]
        http.bodies[Self.messagesPath] = [(200, messages(groups: [], next: "c9"))]
        let store = makeStore(http)
        store.open(at: "gone")
        await store.poll(account: Tokens())
        XCTAssertEqual(store.opening, .missing)
    }
}
