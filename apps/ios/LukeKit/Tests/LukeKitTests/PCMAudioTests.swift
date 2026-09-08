import AVFoundation
import XCTest

@testable import LukeKit

/// The engine's own behaviour is not asserted — `AVAudioEngine` needs a
/// device — so what is left is the format both ends agree on and the policy
/// that says who owns the session under them.
final class PCMAudioTests: XCTestCase {
    func testTheFormatIsWhatTheRealtimeWireSpeaks() {
        let format = PCMAudio.format()
        XCTAssertEqual(format.commonFormat, .pcmFormatFloat32)
        XCTAssertEqual(format.sampleRate, Double(PressAudioBuffer.sampleRate))
        XCTAssertEqual(format.channelCount, 1)
        XCTAssertFalse(format.isInterleaved)
    }

    #if os(iOS) || os(watchOS)
    func testThePhoneOwnsItsSessionAndTheWatchDoesNot() {
        XCTAssertTrue(PCMAudioSessionPolicy.phone.configuresSession)
        XCTAssertFalse(PCMAudioSessionPolicy.hostOwned.configuresSession)
    }

    func testOnlyTheHostOwnedPolicyRefusesADeniedMicrophone() {
        XCTAssertFalse(PCMAudioSessionPolicy.phone.checksRecordPermission)
        XCTAssertTrue(PCMAudioSessionPolicy.hostOwned.checksRecordPermission)
    }

    func testACallerWhoOwnsNoSessionAsksForNoCategoryOptions() {
        XCTAssertTrue(PCMAudioSessionPolicy.hostOwned.categoryOptions.isEmpty)
    }
    #endif

    #if os(iOS)
    func testThePhoneRoutesToTheSpeakerAndAcceptsAHeadset() {
        let options = PCMAudioSessionPolicy.phone.categoryOptions
        XCTAssertTrue(options.contains(.defaultToSpeaker))
        XCTAssertTrue(options.contains(.allowBluetoothHFP))
    }
    #endif
}
