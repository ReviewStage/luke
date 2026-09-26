import Foundation
import XCTest

@testable import LukeKit

/// The captions drawn behind the stored thread while a call stands: the ones
/// the thread has not yet written, and none of the ones it has.
final class LiveCaptionTailTests: XCTestCase {
    private func fixtureTurns() throws -> [ConversationTurnRows] {
        try JSONDecoder().decode(
            ConversationMessagesAnswer.self,
            from: RepositoryFixtures.data(RepositoryFixtures.reads, "conversation-messages-answer.json")
        ).groups.map { ConversationTurnRows(group: $0, roster: []) }
    }

    func testACaptionTheThreadHasNotWrittenIsDrawnAndOneItHasIsNot() throws {
        let turns = try fixtureTurns()
        let streaming = LiveCaptionRow(rowId: 3, speaker: .user, words: "And then deploy")
        let captions = [
            LiveCaptionRow(rowId: 1, speaker: .user, words: "Tell the fixture session to run the tests. "),
            LiveCaptionRow(rowId: 2, speaker: .assistant, words: "Sent."),
            streaming,
        ]
        XCTAssertEqual(LiveCaptionTail.rows(captions: captions, behind: turns), [streaming])
    }

    func testTheSameWordsFromTheOtherSpeakerStillDraw() throws {
        let turns = try fixtureTurns()
        let luke = LiveCaptionRow(rowId: 1, speaker: .assistant, words: "Tell the fixture session to run the tests.")
        XCTAssertEqual(LiveCaptionTail.rows(captions: [luke], behind: turns), [luke])
    }

    func testACaptionWrittenManyTurnsAgoStaysDroppedForTheWholeCall() throws {
        let fixture = try fixtureTurns()
        let later = (0..<8).map { _ in fixture[1] }
        let written = LiveCaptionRow(rowId: 1, speaker: .user, words: "Tell the fixture session to run the tests.")
        XCTAssertEqual(LiveCaptionTail.rows(captions: [written], behind: fixture + later), [])
    }

    func testAnEmptyThreadDrawsEveryCaptionAndNoCaptionDrawsNothing() throws {
        let row = LiveCaptionRow(rowId: 1, speaker: .user, words: "Hello")
        XCTAssertEqual(LiveCaptionTail.rows(captions: [row], behind: []), [row])
        XCTAssertEqual(LiveCaptionTail.rows(captions: [], behind: try fixtureTurns()), [])
    }
}
