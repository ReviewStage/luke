import XCTest

@testable import LukeKit

final class ConversationTimePullTests: XCTestCase {
    func testADragToTheLeftPullsTheColumnInByItsOwnDistance() {
        XCTAssertEqual(ConversationTimePull.distance(dragged: -30, reveal: 72), 30)
        XCTAssertEqual(ConversationTimePull.distance(dragged: -72, reveal: 72), 72)
    }

    func testADragToTheRightPullsNothing() {
        XCTAssertEqual(ConversationTimePull.distance(dragged: 0, reveal: 72), 0)
        XCTAssertEqual(ConversationTimePull.distance(dragged: 40, reveal: 72), 0)
    }

    func testADragPastTheRevealMeetsResistance() {
        XCTAssertEqual(ConversationTimePull.distance(dragged: -122, reveal: 72), 82)
    }

    func testAMostlySidewaysDragIsThePulls() {
        XCTAssertTrue(ConversationTimePull.claimsDrag(width: -20, height: 5))
        XCTAssertTrue(ConversationTimePull.claimsDrag(width: 20, height: -5))
        XCTAssertFalse(ConversationTimePull.claimsDrag(width: -5, height: 20))
        XCTAssertFalse(ConversationTimePull.claimsDrag(width: 10, height: 10))
    }
}
