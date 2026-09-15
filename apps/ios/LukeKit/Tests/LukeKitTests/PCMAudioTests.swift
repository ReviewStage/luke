import AVFoundation
import XCTest

@testable import LukeKit

/// The engine's own behaviour is not asserted — `AVAudioEngine` needs a
/// device — so what is left is the format both ends agree on.
final class PCMAudioTests: XCTestCase {
    func testTheFormatIsWhatTheWireSpeaks() {
        let format = PCMAudio.format(sampleRate: 16_000)
        XCTAssertEqual(format.commonFormat, .pcmFormatFloat32)
        XCTAssertEqual(format.sampleRate, 16_000)
        XCTAssertEqual(format.channelCount, 1)
        XCTAssertFalse(format.isInterleaved)
    }
}
