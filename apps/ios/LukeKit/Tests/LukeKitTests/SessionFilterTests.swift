import Foundation
import XCTest

@testable import LukeKit

private func makeSession(provider: String, status: String) -> RosterSession {
    RosterSession(json: [
        "providerId": provider,
        "sessionId": UUID().uuidString,
        "title": "Task",
        "status": status,
    ])!
}

// MARK: - Matching

final class SessionFilterMatchTests: XCTestCase {
    func testEmptySelectionIsUnnarrowed() {
        XCTAssertTrue(matchesFilterSelection([], session: makeSession(provider: "conductor", status: "working")))
    }

    func testValuesWithinAnAxisAreORed() {
        let either: Set<SessionFilter> = [.provider("conductor"), .provider("codex")]
        XCTAssertTrue(matchesFilterSelection(either, session: makeSession(provider: "conductor", status: "working")))
        XCTAssertTrue(matchesFilterSelection(either, session: makeSession(provider: "codex", status: "waiting")))
        XCTAssertFalse(matchesFilterSelection(either, session: makeSession(provider: "omp", status: "working")))
    }

    func testAxesAreANDed() {
        let both: Set<SessionFilter> = [.provider("conductor"), .status("waiting")]
        XCTAssertTrue(matchesFilterSelection(both, session: makeSession(provider: "conductor", status: "waiting")))
        XCTAssertFalse(matchesFilterSelection(both, session: makeSession(provider: "conductor", status: "working")))
        XCTAssertFalse(matchesFilterSelection(both, session: makeSession(provider: "codex", status: "waiting")))
    }

    func testAxisWithSelectionStillAsksWhenOtherAxisEmpty() {
        let statusOnly: Set<SessionFilter> = [.status("complete")]
        XCTAssertTrue(matchesFilterSelection(statusOnly, session: makeSession(provider: "codex", status: "complete")))
        XCTAssertFalse(matchesFilterSelection(statusOnly, session: makeSession(provider: "codex", status: "working")))
    }
}

// MARK: - Options

final class SessionFilterOptionsTests: XCTestCase {
    func testAxisOfferedOnlyWhenARealChoice() {
        let sessions = [
            makeSession(provider: "conductor", status: "working"),
            makeSession(provider: "codex", status: "working"),
        ]
        let groups = sessionFilterOptions(sessions: sessions, selection: [])
        XCTAssertEqual(groups.map(\.axis), [.provider])
    }

    func testNoAxisOfferedForEmptyOrUniformRoster() {
        XCTAssertTrue(sessionFilterOptions(sessions: [], selection: []).isEmpty)
        let uniform = [
            makeSession(provider: "conductor", status: "working"),
            makeSession(provider: "conductor", status: "working"),
        ]
        XCTAssertTrue(sessionFilterOptions(sessions: uniform, selection: []).isEmpty)
    }

    func testOptionsCarryCountsSortedByValue() {
        let sessions = [
            makeSession(provider: "codex", status: "working"),
            makeSession(provider: "conductor", status: "waiting"),
            makeSession(provider: "codex", status: "complete"),
        ]
        let groups = sessionFilterOptions(sessions: sessions, selection: [])
        XCTAssertEqual(groups.map(\.axis), [.provider, .status])
        XCTAssertEqual(groups[0].options, [
            SessionFilterOption(filter: .provider("conductor"), count: 1),
            SessionFilterOption(filter: .provider("codex"), count: 2),
        ])
        XCTAssertEqual(groups[1].options, [
            SessionFilterOption(filter: .status("complete"), count: 1),
            SessionFilterOption(filter: .status("waiting"), count: 1),
            SessionFilterOption(filter: .status("working"), count: 1),
        ])
    }

    func testSelectedValueNoLongerObservedStaysListedAtZero() {
        let sessions = [
            makeSession(provider: "conductor", status: "working"),
            makeSession(provider: "codex", status: "working"),
        ]
        let groups = sessionFilterOptions(sessions: sessions, selection: [.provider("omp")])
        XCTAssertEqual(groups.map(\.axis), [.provider])
        XCTAssertTrue(groups[0].options.contains(SessionFilterOption(filter: .provider("omp"), count: 0)))
    }
}
