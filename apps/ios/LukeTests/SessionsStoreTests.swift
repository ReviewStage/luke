import Foundation
import LukeKit
import XCTest

@testable import Luke

/// The store the Luke screen, the list, and the session screens share. None
/// of what is asserted here reaches the network: every case is a press a
/// screen itself draws a control for.
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

    func testShowingSessionsPushesTheListOverLuke() {
        let store = makeStore()
        store.showSessions()
        XCTAssertEqual(store.path, [.sessions])
    }

    func testShowingSessionsFromASessionScreenPopsToTheList() {
        let store = makeStore()
        store.showSessions()
        store.open(makeSession("a"))
        store.showSessions()
        XCTAssertEqual(store.path, [.sessions])
    }

    func testOpeningASessionPushesItsScreenOverTheList() {
        let store = makeStore()
        let session = makeSession("a")
        store.showSessions()
        store.open(session)
        XCTAssertEqual(store.path, [.sessions, .session(session)])
    }

    func testOpeningFromTheConversationStandsTheListUnderTheScreen() {
        let store = makeStore()
        let session = makeSession("a")
        store.openLeavingConversation(session)
        XCTAssertEqual(store.path, [.sessions, .session(session)])
    }

    func testOpeningTheConversationPopsToLuke() {
        let store = makeStore()
        store.showSessions()
        store.open(makeSession("a"))
        store.openConversation()
        XCTAssertTrue(store.path.isEmpty)
    }

    func testClosingAScreenLeavesTheListAndEveryOtherSessionStanding() {
        let store = makeStore()
        let first = makeSession("a")
        let second = makeSession("b")
        store.showSessions()
        store.open(first)
        store.open(second)
        store.closeScreen(of: first)
        XCTAssertEqual(store.path, [.sessions, .session(second)])
    }

    func testArchivingRemovesTheRowAndItsScreenAtThePress() {
        let store = makeStore()
        let session = makeSession("a")
        store.sessions = [session, makeSession("b")]
        store.showSessions()
        store.open(session)
        store.beginArchiving(session)
        XCTAssertEqual(store.sessions.map(\.sessionId), ["b"])
        XCTAssertEqual(store.path, [.sessions], "the list stays under where the screen was")
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
}
