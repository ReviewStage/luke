import Foundation
import LukeKit
import XCTest

@testable import Luke

/// The store the list, the session screens, and the voice screen share. None
/// of what is asserted here reaches the network: every case is a press the
/// list itself draws a control for.
@MainActor
final class SessionsStoreTests: XCTestCase {
    private func makeStore() -> SessionsStore {
        // Never sent to: no case here calls `refresh`.
        let url = URL(string: "https://example.invalid")!
        return SessionsStore(rosterClient: RosterClient(serviceURL: url))
    }

    private func makeSession(_ sessionId: String) -> RosterSession {
        RosterSession(
            providerId: "conductor",
            sessionId: sessionId,
            title: "Session \(sessionId)",
            status: "working"
        )
    }

    func testOpeningASessionPushesItsScreen() {
        let store = makeStore()
        let session = makeSession("a")
        store.open(session)
        XCTAssertEqual(store.path, [.session(session)])
        XCTAssertEqual(store.tab, .luke)
    }

    func testOpeningFromTheConversationLeavesTheLukeTab() {
        let store = makeStore()
        let session = makeSession("a")
        store.openLeavingConversation(session)
        XCTAssertEqual(store.tab, .sessions)
        XCTAssertEqual(store.path, [.session(session)])
    }

    func testClosingAScreenLeavesEveryOtherSessionStanding() {
        let store = makeStore()
        let first = makeSession("a")
        let second = makeSession("b")
        store.open(first)
        store.open(second)
        store.closeScreen(of: first)
        XCTAssertEqual(store.path, [.session(second)])
    }

    func testArchivingRemovesTheRowAndItsScreenAtThePress() {
        let store = makeStore()
        let session = makeSession("a")
        store.sessions = [session, makeSession("b")]
        store.open(session)
        store.beginArchiving(session)
        XCTAssertEqual(store.sessions.map(\.sessionId), ["b"])
        XCTAssertTrue(store.path.isEmpty)
    }

    func testARefusedArchiveRestoresTheRow() {
        let store = makeStore()
        let session = makeSession("a")
        store.sessions = [session]
        store.beginArchiving(session)
        store.endArchiving(session, delivered: false)
        XCTAssertEqual(store.sessions.map(\.sessionId), ["a"])
    }

    func testADeliveredArchiveLeavesTheRowGone() {
        let store = makeStore()
        let session = makeSession("a")
        store.sessions = [session]
        store.beginArchiving(session)
        store.endArchiving(session, delivered: true)
        XCTAssertTrue(store.sessions.isEmpty)
    }

    func testAnArchiveStandingCannotBeRestoredTwice() {
        let store = makeStore()
        let session = makeSession("a")
        store.sessions = [session]
        store.beginArchiving(session)
        store.endArchiving(session, delivered: false)
        store.endArchiving(session, delivered: false)
        XCTAssertEqual(store.sessions.map(\.sessionId), ["a"])
    }

    func testAShownListShowsTheSearchItNarrowedBy() {
        let store = makeStore()
        store.open(makeSession("a"))
        store.showList(VoiceAsks.SessionListAsk(filters: nil, sort: .recency, query: "luke"))
        XCTAssertEqual(store.tab, .sessions)
        XCTAssertTrue(store.path.isEmpty)
        XCTAssertEqual(store.sort, .recency)
        XCTAssertEqual(store.searchQuery, "luke")
        XCTAssertTrue(store.searchPresented)
    }

    func testAShownListLeavesWhatTheAskDidNotName() {
        let store = makeStore()
        store.searchQuery = "standing"
        store.sort = .urgency
        store.showList(VoiceAsks.SessionListAsk(filters: [], sort: nil, query: nil))
        XCTAssertEqual(store.sort, .urgency)
        XCTAssertEqual(store.searchQuery, "standing")
        XCTAssertFalse(store.searchPresented)
    }
}
