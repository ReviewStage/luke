import Foundation
import XCTest

@testable import Luke

/// The talk button's own transition, which the gesture above it reads at every
/// release. It lives with the button because the button is its only caller.
final class VoiceViewTests: XCTestCase {
    func testQuickFirstTapLatchesListening() {
        XCTAssertEqual(
            talkButtonReleaseAction(heldDuration: 0.04, wasLatched: false),
            .latch
        )
    }

    func testHoldSendsOnFirstRelease() {
        XCTAssertEqual(
            talkButtonReleaseAction(
                heldDuration: talkButtonTapDuration + 0.001,
                wasLatched: false
            ),
            .send
        )
    }

    func testSecondTapSendsLatchedTurn() {
        XCTAssertEqual(
            talkButtonReleaseAction(heldDuration: 0.01, wasLatched: true),
            .send
        )
    }
}
