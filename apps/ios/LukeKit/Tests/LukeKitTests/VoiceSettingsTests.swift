import Foundation
import XCTest

@testable import LukeKit

final class VoiceSettingsTests: XCTestCase {
    /// The voices must match `REALTIME_VOICE_LIST` name for name and in its
    /// order: the mint refuses a voice outside the API's set, so a drifted
    /// case is a picker row that cannot work.
    func testVoicesMatchTheSharedVocabulary() {
        XCTAssertEqual(
            RealtimeVoice.allCases.map(\.rawValue),
            ["alloy", "ash", "ballad", "cedar", "coral", "echo", "marin", "sage", "shimmer", "verse"]
        )
        XCTAssertEqual(RealtimeVoice.default, .echo)
        XCTAssertEqual(RealtimeVoice.coral.displayName, "Coral")
        XCTAssertNil(RealtimeVoice(rawValue: "Echo"))
    }

    /// The speeds must match `REALTIME_VOICE_SPEED` step for step, slowest
    /// to fastest, because the mint validates the multiple against that set.
    func testSpeedsMatchTheSharedVocabulary() {
        XCTAssertEqual(RealtimeVoiceSpeed.allCases, [.slow, .normal, .quick, .fast])
        XCTAssertEqual(RealtimeVoiceSpeed.allCases.map(\.multiplier), [0.75, 1, 1.25, 1.5])
        XCTAssertEqual(RealtimeVoiceSpeed.default, .normal)
        XCTAssertEqual(RealtimeVoiceSpeed.quick.multipleLabel, "1.25×")
        XCTAssertEqual(RealtimeVoiceSpeed.normal.multipleLabel, "1×")
        XCTAssertNil(RealtimeVoiceSpeed(rawValue: "1.25"))
    }
}
