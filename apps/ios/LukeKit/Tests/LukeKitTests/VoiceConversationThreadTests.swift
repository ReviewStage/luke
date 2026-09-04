import Foundation
import XCTest

@testable import LukeKit

@MainActor
final class VoiceConversationThreadTests: XCTestCase {
    func testCaptionStreamsIntoOneMessage() {
        let thread = VoiceConversationThread()
        thread.beginTurn()
        thread.recordCaption("Working")
        thread.recordCaption("Working on it")
        XCTAssertEqual(thread.messages.map(\.words), ["Working on it"])
        XCTAssertEqual(thread.messages.first?.speaker, .luke)
    }

    func testCaptionAfterSegmentEndStartsANewBubble() {
        let thread = VoiceConversationThread()
        thread.beginTurn()
        thread.recordCaption("First reply")
        thread.recordCaption(nil)
        thread.recordCaption("Tool follow-up")
        XCTAssertEqual(thread.messages.map(\.words), ["First reply", "Tool follow-up"])
    }

    func testLateSpokenAskLandsBeforeItsTurnsReply() {
        let thread = VoiceConversationThread()
        thread.beginTurn()
        thread.recordCaption("The tests are green.")
        thread.recordSpokenAsk("How are the tests?")
        XCTAssertEqual(
            thread.messages.map(\.words),
            ["How are the tests?", "The tests are green."]
        )
        XCTAssertEqual(thread.messages.map(\.speaker), [.developer, .luke])
    }

    func testSpokenAskReplacesItsTurnsEarlierTranscription() {
        let thread = VoiceConversationThread()
        thread.beginTurn()
        thread.recordSpokenAsk("How are")
        thread.recordSpokenAsk("How are the tests?")
        XCTAssertEqual(thread.messages.map(\.words), ["How are the tests?"])
    }

    func testTurnsStaySeparated() {
        let thread = VoiceConversationThread()
        thread.beginTurn()
        thread.recordSpokenAsk("First ask")
        thread.recordCaption("First reply")
        thread.recordCaption(nil)
        thread.beginTurn()
        thread.recordCaption("Second reply")
        thread.recordSpokenAsk("Second ask")
        XCTAssertEqual(
            thread.messages.map(\.words),
            ["First ask", "First reply", "Second ask", "Second reply"]
        )
    }

    func testTypedAskOpensItsOwnTurn() {
        let thread = VoiceConversationThread()
        thread.beginTurn()
        thread.recordSpokenAsk("First ask")
        thread.recordCaption("First reply")
        thread.recordCaption(nil)
        thread.recordTypedAsk("  Open the Codex session  ")
        thread.recordCaption("Opening it.")
        XCTAssertEqual(
            thread.messages.map(\.words),
            ["First ask", "First reply", "Open the Codex session", "Opening it."]
        )
        XCTAssertEqual(
            thread.messages.map(\.typed),
            [false, false, true, false]
        )
        XCTAssertEqual(thread.messages[2].speaker, .developer)
        XCTAssertEqual(thread.messages[2].turnId, thread.messages[3].turnId)
    }

    func testLateTranscriptNeverReplacesATypedAsk() {
        let thread = VoiceConversationThread()
        thread.recordTypedAsk("Open the Codex session")
        thread.recordSpokenAsk("A spoken turn's late transcript")
        XCTAssertEqual(thread.messages.map(\.words), ["Open the Codex session"])
    }

    func testEmptyTypedAskRecordsNothing() {
        let thread = VoiceConversationThread()
        thread.recordTypedAsk("   \n")
        XCTAssertTrue(thread.messages.isEmpty)
    }

    func testEmptySpokenAskRecordsNothing() {
        let thread = VoiceConversationThread()
        thread.beginTurn()
        thread.recordSpokenAsk("   \n")
        XCTAssertTrue(thread.messages.isEmpty)
    }

    func testClearEmptiesTheThreadAndTheTurnState() {
        let thread = VoiceConversationThread()
        thread.beginTurn()
        thread.recordSpokenAsk("Before sign-out")
        thread.recordCaption("A reply")
        thread.clear()
        XCTAssertTrue(thread.messages.isEmpty)
        thread.recordCaption("After")
        XCTAssertEqual(thread.messages.map(\.words), ["After"])
    }

    func testRetentionDropsTheOldestLines() {
        let thread = VoiceConversationThread()
        for index in 0 ..< (VoiceConversationThread.maximumRetainedMessages + 5) {
            thread.beginTurn()
            thread.recordSpokenAsk("Ask \(index)")
        }
        XCTAssertEqual(thread.messages.count, VoiceConversationThread.maximumRetainedMessages)
        XCTAssertEqual(thread.messages.first?.words, "Ask 5")
    }
}
