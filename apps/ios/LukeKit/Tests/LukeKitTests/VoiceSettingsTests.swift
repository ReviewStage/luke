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
        XCTAssertEqual(
            RealtimeVoice.allCases.map(\.rawValue),
            ["alloy", "ash", "ballad", "cedar", "coral", "echo", "marin", "sage", "shimmer", "verse"]
        )
        XCTAssertEqual(LiveVoice.default, .marin)
        XCTAssertEqual(LiveVoice.beacon.displayName, "Beacon")
        XCTAssertEqual(LiveVoice.beacon.id, "beacon")
        XCTAssertNil(LiveVoice(rawValue: "Echo"))
        XCTAssertEqual(RealtimeVoice.default, .marin)
        XCTAssertNil(RealtimeVoice(rawValue: "beacon"), "a Live voice the watch's mint cannot speak reads as the default")
        XCTAssertEqual(RealtimeVoice.coral.displayName, "Coral")
        XCTAssertNil(RealtimeVoice(rawValue: "Echo"))
    }

    func testSpeedsMatchTheSharedVocabulary() {
        XCTAssertEqual(RealtimeVoiceSpeed.allCases, [.slow, .normal, .quick, .fast])
        XCTAssertEqual(RealtimeVoiceSpeed.allCases.map(\.multiplier), [0.75, 1, 1.25, 1.5])
        XCTAssertEqual(RealtimeVoiceSpeed.default, .normal)
        XCTAssertEqual(RealtimeVoiceSpeed.quick.multipleLabel, "1.25×")
        XCTAssertEqual(RealtimeVoiceSpeed.normal.multipleLabel, "1×")
        XCTAssertNil(RealtimeVoiceSpeed(rawValue: "1.25"))
    }

    func testSliderStepsCoverExactlyTheSpeeds() {
        var landed: [RealtimeVoiceSpeed?] = []
        var value = RealtimeVoiceSpeed.multiplierRange.lowerBound
        while value <= RealtimeVoiceSpeed.multiplierRange.upperBound + 0.0001 {
            landed.append(RealtimeVoiceSpeed(multiplier: value))
            value += RealtimeVoiceSpeed.multiplierStep
        }
        XCTAssertEqual(landed, [.slow, .normal, .quick, .fast])
        XCTAssertEqual(RealtimeVoiceSpeed(multiplier: 1.2500001), .quick)
        XCTAssertNil(RealtimeVoiceSpeed(multiplier: 1.1))
        XCTAssertNil(RealtimeVoiceSpeed(multiplier: 2))
    }
}
