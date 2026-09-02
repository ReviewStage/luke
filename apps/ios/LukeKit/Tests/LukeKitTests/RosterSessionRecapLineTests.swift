import XCTest

@testable import LukeKit

final class RosterSessionRecapLineTests: XCTestCase {
    private func session(recap: String?) -> RosterSession {
        RosterSession(providerId: "conductor", sessionId: "s1", title: "Ship it", status: "idle", recap: recap)
    }

    func testClosesLineBreaksAndSpaceRunsToSingleSpaces() {
        XCTAssertEqual(
            session(recap: "## Done\n\nFixed it.\n- a\n-   b").recapLine,
            "## Done Fixed it. - a - b"
        )
    }

    func testLeavesAOneLineRecapAlone() {
        XCTAssertEqual(session(recap: "Fixed the flaky test.").recapLine, "Fixed the flaky test.")
    }

    func testNoRecapIsNoLine() {
        XCTAssertNil(session(recap: nil).recapLine)
    }
}
