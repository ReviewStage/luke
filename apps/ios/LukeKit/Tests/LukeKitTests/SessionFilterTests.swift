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
        let either: Set<SessionFilter> = [.provider("conductor"), .provider("devin")]
        XCTAssertTrue(matchesFilterSelection(either, session: makeSession(provider: "conductor", status: "working")))
        XCTAssertTrue(matchesFilterSelection(either, session: makeSession(provider: "devin", status: "waiting")))
        XCTAssertFalse(matchesFilterSelection(either, session: makeSession(provider: "jules", status: "working")))
    }

    func testAxesAreANDed() {
        let both: Set<SessionFilter> = [.provider("conductor"), .status("waiting")]
        XCTAssertTrue(matchesFilterSelection(both, session: makeSession(provider: "conductor", status: "waiting")))
        XCTAssertFalse(matchesFilterSelection(both, session: makeSession(provider: "conductor", status: "working")))
        XCTAssertFalse(matchesFilterSelection(both, session: makeSession(provider: "devin", status: "waiting")))
    }

    func testAxisWithSelectionStillAsksWhenOtherAxisEmpty() {
        let statusOnly: Set<SessionFilter> = [.status("complete")]
        XCTAssertTrue(matchesFilterSelection(statusOnly, session: makeSession(provider: "devin", status: "complete")))
        XCTAssertFalse(matchesFilterSelection(statusOnly, session: makeSession(provider: "devin", status: "working")))
    }
}

// MARK: - Options

final class SessionFilterOptionsTests: XCTestCase {
    func testAxisOfferedOnlyWhenARealChoice() {
        let sessions = [
            makeSession(provider: "conductor", status: "working"),
            makeSession(provider: "devin", status: "working"),
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
            makeSession(provider: "devin", status: "working"),
            makeSession(provider: "conductor", status: "waiting"),
            makeSession(provider: "devin", status: "complete"),
        ]
        let groups = sessionFilterOptions(sessions: sessions, selection: [])
        XCTAssertEqual(groups.map(\.axis), [.provider, .status])
        XCTAssertEqual(groups[0].options, [
            SessionFilterOption(filter: .provider("conductor"), count: 1),
            SessionFilterOption(filter: .provider("devin"), count: 2),
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
            makeSession(provider: "devin", status: "working"),
        ]
        let groups = sessionFilterOptions(sessions: sessions, selection: [.provider("jules")])
        XCTAssertEqual(groups.map(\.axis), [.provider])
        XCTAssertTrue(groups[0].options.contains(SessionFilterOption(filter: .provider("jules"), count: 0)))
    }
}
