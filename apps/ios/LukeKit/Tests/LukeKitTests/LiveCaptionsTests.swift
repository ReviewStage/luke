import Foundation
import XCTest

@testable import LukeKit

/// The phone's caption ledger against the cases `packages/live/src/transcript.test.ts`
/// and `live-captions.test.ts` hold the desktop's to.
final class LiveCaptionsTests: XCTestCase {
    private static func delta(_ text: String, _ startMs: Int, _ endMs: Int) -> LiveTranscriptDelta {
        LiveTranscriptDelta(eventId: "event_\(startMs)", delta: text, startMs: startMs, endMs: endMs)
    }

    @MainActor
    func testFragmentsWithinTheGapJoinOneRowVerbatim() async {
        let captions = LiveCaptions(now: { Date(timeIntervalSince1970: 0) })
        captions.append(.user, Self.delta("Hel", 0, 200))
        captions.append(.user, Self.delta("lo ", 200, 400))
        captions.append(.user, Self.delta(" there", 1_500, 1_800))
        XCTAssertEqual(
            captions.rows,
            [LiveCaptionRow(rowId: 1, speaker: .user, words: "Hello  there")],
            "a fragment is appended as received: no trim, no inserted space"
        )
    }

    @MainActor
    func testASilenceLongerThanTheGapOpensANewRow() async {
        let captions = LiveCaptions(now: { Date(timeIntervalSince1970: 0) })
        captions.append(.assistant, Self.delta("One.", 0, 500))
        let secondStartMs = 500 + LiveTranscriptBounds.utteranceGapMs + 1
        captions.append(.assistant, Self.delta("Two.", secondStartMs, secondStartMs + 1_000))
        XCTAssertEqual(captions.rows.map(\.rowId), [1, 2])
        XCTAssertEqual(captions.rows.map(\.words), ["One.", "Two."])
    }

    @MainActor
    func testTheSpeakersOverlapWithoutSplittingEachOther() async {
        let captions = LiveCaptions(now: { Date(timeIntervalSince1970: 0) })
        captions.append(.assistant, Self.delta("The build ", 0, 600))
        captions.append(.user, Self.delta("yes", 300, 500))
        captions.append(.assistant, Self.delta("passed.", 600, 1_000))
        XCTAssertEqual(captions.rows.map(\.speaker), [.assistant, .user])
        XCTAssertEqual(captions.rows.map(\.words), ["The build passed.", "yes"])
    }

    @MainActor
    func testALateFragmentGrowsTheRowItsTimestampsPlaceItIn() async {
        let captions = LiveCaptions(now: { Date(timeIntervalSince1970: 0) })
        captions.append(.user, Self.delta("first", 0, 400))
        captions.append(.user, Self.delta("second", 5_000, 5_400))
        captions.append(.user, Self.delta(" late", 400, 700))
        XCTAssertEqual(captions.rows.map(\.rowId), [1, 2], "rows keep the order they opened in")
        XCTAssertEqual(captions.rows.map(\.words), ["first late", "second"])
    }

    @MainActor
    func testAFragmentEndingBeforeItStartsIsRefused() async {
        let captions = LiveCaptions(now: { Date(timeIntervalSince1970: 0) })
        XCTAssertNil(captions.append(.user, Self.delta("x", 500, 400)))
        XCTAssertEqual(captions.rows, [])
    }

    @MainActor
    func testARowSettlesOnceTheGapAndTheMarginHavePassedOnThePhonesClock() async {
        var now = Date(timeIntervalSince1970: 10)
        let captions = LiveCaptions(now: { now })
        let settleSeconds = Double(LiveTranscriptBounds.utteranceGapMs + LiveTranscriptBounds.utteranceSettleMarginMs) / 1000
        captions.append(.assistant, Self.delta("Done.", 0, 400))
        XCTAssertTrue(captions.unsettled)

        now = now.addingTimeInterval(settleSeconds - 0.001)
        XCTAssertTrue(captions.unsettled, "a fragment may still join for the gap plus the margin")

        now = now.addingTimeInterval(0.001)
        XCTAssertFalse(captions.unsettled)

        captions.append(.assistant, Self.delta(" Really.", 400, 900))
        XCTAssertTrue(captions.unsettled, "a late fragment reopens the row it joined")
        XCTAssertEqual(captions.rows[0].words, "Done. Really.")
    }
}
