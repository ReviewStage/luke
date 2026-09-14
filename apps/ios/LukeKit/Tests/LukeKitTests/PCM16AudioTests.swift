import Foundation
import XCTest

@testable import LukeKit

/// The bytes the audio route carries: signed 16-bit little-endian, base64,
/// whole samples only, whichever way they travel.
final class PCM16AudioTests: XCTestCase {
    func testSamplesAreLittleEndianBytesInBase64() {
        XCTAssertEqual(PCM16Audio.base64([1, -2]), "AQD+/w==")
        XCTAssertEqual(PCM16Audio.base64([Int16.min, Int16.max]), Data([0x00, 0x80, 0xFF, 0x7F]).base64EncodedString())
        XCTAssertEqual(PCM16Audio.base64([]), "")
    }

    func testTheWireRoundTrips() {
        let samples: [Int16] = [0, 1, -1, 12345, -12345, Int16.max, Int16.min]
        XCTAssertEqual(PCM16Audio.samples(base64: PCM16Audio.base64(samples)), samples)
        XCTAssertEqual(PCM16Audio.samples(base64: ""), [])
    }

    func testWhatIsNotWholeSamplesInBase64IsNothing() {
        XCTAssertNil(PCM16Audio.samples(base64: "AQAB"), "three bytes split a sample")
        XCTAssertNil(PCM16Audio.samples(base64: "not base64!"))
    }
}
