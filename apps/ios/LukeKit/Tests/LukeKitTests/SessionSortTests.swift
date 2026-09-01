import Foundation
import XCTest

@testable import LukeKit

private func makeSession(_ id: String, status: String, observedAt: Double? = nil) -> RosterSession {
    var json: [String: Any] = [
        "providerId": "conductor",
        "sessionId": id,
        "title": "Task",
        "status": status,
    ]
    if let observedAt { json["observedAt"] = observedAt }
    return RosterSession(json: json)!
}

final class SessionSortTests: XCTestCase {
    func testUrgencyRanksNeedsYouFirstAndUnknownStatusLast() {
        let sessions = [
            makeSession("done", status: "complete"),
            makeSession("novel", status: "someday-status"),
            makeSession("busy", status: "working"),
            makeSession("stuck", status: "error"),
            makeSession("held", status: "waiting"),
        ]
        // stuck and held tie on urgency with no dates, so the wire's own
        // order between them survives the sort.
        XCTAssertEqual(
            sortedSessions(sessions, by: .urgency).map(\.sessionId),
            ["stuck", "held", "busy", "done", "novel"]
        )
    }

    func testUrgencyTiesBreakByRecency() {
        let sessions = [
            makeSession("old", status: "working", observedAt: 1_000),
            makeSession("new", status: "working", observedAt: 2_000),
        ]
        XCTAssertEqual(sortedSessions(sessions, by: .urgency).map(\.sessionId), ["new", "old"])
    }

    func testRecencyPutsLastMovedFirst() {
        let sessions = [
            makeSession("old", status: "waiting", observedAt: 1_000),
            makeSession("new", status: "complete", observedAt: 2_000),
            makeSession("undated", status: "working"),
        ]
        XCTAssertEqual(
            sortedSessions(sessions, by: .recency).map(\.sessionId),
            ["new", "old", "undated"]
        )
    }

    func testRecencyTiesBreakByUrgency() {
        let sessions = [
            makeSession("done", status: "complete", observedAt: 1_000),
            makeSession("stuck", status: "error", observedAt: 1_000),
        ]
        XCTAssertEqual(sortedSessions(sessions, by: .recency).map(\.sessionId), ["stuck", "done"])
    }
}
