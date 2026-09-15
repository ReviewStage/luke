import Foundation
import XCTest

@testable import LukeKit

final class VoiceSettingsTests: XCTestCase {
    func testVoicesMatchTheSharedVocabulary() {
        XCTAssertEqual(
            LiveVoice.allCases.map(\.rawValue),
            [
                "alloy", "ash", "ballad", "beacon", "bossa", "cedar", "cinder", "coral", "delta", "echo",
                "gleam", "marin", "meridian", "quartz", "ripple", "sage", "shimmer", "stone", "tempo",
                "verse", "vesper", "willow",
            ]
        )
        XCTAssertEqual(LiveVoice.default, .marin)
        XCTAssertEqual(LiveVoice.beacon.displayName, "Beacon")
        XCTAssertEqual(LiveVoice.beacon.id, "beacon")
        XCTAssertNil(LiveVoice(rawValue: "Echo"))
    }
}
