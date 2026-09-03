import Foundation
import XCTest

@testable import LukeKit

/// Mirrors the desktop's boundary test for the same rule
/// (`apps/desktop/src/renderer/session-model.test.ts`), so the two surfaces
/// cannot drift apart silently: the label reports the coarsest unit that has
/// begun, and a timestamp ahead of the clock is skew, not the future.
final class LastActivityLabelTests: XCTestCase {
    func testWordedByTheUnitThatHasBegun() {
        let minute: TimeInterval = 60
        let now = Date(timeIntervalSince1970: 100 * 24 * 60 * minute)
        func label(_ lastActivityAt: Date) -> String {
            lastActivityLabel(lastActivityAt: lastActivityAt, now: now)
        }

        XCTAssertEqual(label(now), "Now")
        XCTAssertEqual(label(now.addingTimeInterval(-59)), "Now")
        XCTAssertEqual(label(now.addingTimeInterval(minute)), "Now")
        XCTAssertEqual(label(now.addingTimeInterval(-minute)), "1m")
        XCTAssertEqual(label(now.addingTimeInterval(-59 * minute)), "59m")
        XCTAssertEqual(label(now.addingTimeInterval(-60 * minute)), "1h")
        XCTAssertEqual(label(now.addingTimeInterval(-23 * 60 * minute)), "23h")
        XCTAssertEqual(label(now.addingTimeInterval(-24 * 60 * minute)), "1d")
        XCTAssertEqual(label(now.addingTimeInterval(-3 * 24 * 60 * minute)), "3d")
    }
}
