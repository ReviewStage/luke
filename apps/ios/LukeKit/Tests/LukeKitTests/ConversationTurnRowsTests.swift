import Foundation
import XCTest

@testable import LukeKit

/// A turn group as rows: what stands as a row, what folds, and whose
/// judgment each row records.
final class ConversationTurnRowsTests: XCTestCase {
    private func fixtureGroups() throws -> [ConversationReadTurnGroup] {
        try JSONDecoder().decode(
            ConversationMessagesAnswer.self,
            from: RepositoryFixtures.data(RepositoryFixtures.reads, "conversation-messages-answer.json")
        ).groups
    }

    func testATypedAskDrawsTheDevelopersWordsAndOneActionRow() throws {
        let rows = ConversationTurnRows(group: try fixtureGroups()[0], roster: [])
        XCTAssertEqual(rows.judgment, .ask)
        XCTAssertFalse(rows.pending)
        XCTAssertEqual(rows.rows.count, 3)
        guard case .words(_, let speaker, let text, _, let unspoken) = rows.rows[0] else { return XCTFail("the ask") }
        XCTAssertEqual(speaker, .you)
        XCTAssertEqual(text, "Tell the fixture session to run the tests.")
        XCTAssertFalse(unspoken)
        guard case .action(_, let action, _) = rows.rows[1] else { return XCTFail("the action") }
        XCTAssertEqual(action.kind, .message)
        XCTAssertEqual(action.outcome, .accepted)
        guard case .words(_, let replySpeaker, let reply, _, _) = rows.rows[2] else { return XCTFail("the reply") }
        XCTAssertEqual(replySpeaker, .luke)
        XCTAssertEqual(reply, "Sent.")
    }

    func testARosterDiffTurnIsLukesOwnAndItsBriefingIsHisWords() throws {
        let rows = ConversationTurnRows(group: try fixtureGroups()[1], roster: [])
        XCTAssertEqual(rows.judgment, .own)
        XCTAssertEqual(rows.rows.count, 1)
        guard case .words(_, let speaker, let text, _, let unspoken) = rows.rows[0] else { return XCTFail("the briefing") }
        XCTAssertEqual(speaker, .luke)
        XCTAssertEqual(text, "The fixture session is waiting on a permission prompt.")
        XCTAssertFalse(unspoken)
    }

    func testAnUnspokenBriefingCarriesItsMark() throws {
        let group = try fixtureGroups()[1]
        let message = group.messages[0]
        let identity = message.tools[0].identity
        let marked = ConversationReadTurnGroup(
            turnId: group.turnId, conversationId: group.conversationId, source: group.source, turn: group.turn,
            messages: [
                ConversationReadMessage(
                    message: message.message, seq: message.seq, createdAt: message.createdAt,
                    tools: [.announce(identity, unspoken: true)]
                ),
            ]
        )
        guard case .words(_, _, _, _, let unspoken) = ConversationTurnRows(group: marked, roster: []).rows[0] else {
            return XCTFail("the briefing")
        }
        XCTAssertTrue(unspoken)
    }

    /// The `observation-acted.json` view fixture as the service would group it: a
    /// hold-release turn whose reply carried an accepted action, a refused one, and
    /// an unknown one.
    private func actedGroup(status: TurnStatus = .settled) throws -> ConversationReadTurnGroup {
        let view = try RepositoryFixtures.json(RepositoryFixtures.conversationView, "observation-acted.json")
        let observed = try XCTUnwrap((view["observed"] as? [[String: Any]])?.first)
        let rows = try XCTUnwrap(observed["messages"] as? [[String: Any]])
        let bytes = try JSONSerialization.data(withJSONObject: try XCTUnwrap(rows[1]["message"]))
        let reply = try JSONDecoder().decode(UIMessage.self, from: bytes)
        let parts = reply.toolParts
        let identity = { (part: ToolPart) in
            ToolPartIdentity(toolCallId: part.toolCallId, toolName: part.toolName, state: part.state)
        }
        let session = SessionIdentity(providerId: "conductor", providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50")
        return ConversationReadTurnGroup(
            turnId: "1a000000-0000-4000-8000-000000000004",
            conversationId: "3c000000-0000-4000-8000-000000000002",
            source: .observed(session),
            turn: ConversationViewTurn(
                id: "1a000000-0000-4000-8000-000000000004", origin: .holdRelease, status: status,
                queuedAt: Date(timeIntervalSince1970: 1_757_505_780)
            ),
            messages: [
                ConversationReadMessage(
                    message: reply, seq: 42, createdAt: Date(timeIntervalSince1970: 1_757_505_782.1),
                    tools: [
                        .action(identity(parts[0]), outcome: .accepted),
                        .action(identity(parts[1]), outcome: .refused),
                        .action(identity(parts[2]), outcome: .unknown),
                    ]
                ),
            ]
        )
    }

    func testSeveralActionsFoldAndARefusedOneCollapsesIntoTheDetails() throws {
        let rows = ConversationTurnRows(group: try actedGroup(), roster: [])
        XCTAssertEqual(rows.judgment, .own)
        XCTAssertFalse(rows.pending)
        XCTAssertEqual(rows.rows.count, 4)
        guard case .reasoning = rows.rows[0] else { return XCTFail("the thought") }
        guard case .actionsFold(_, let folded, _) = rows.rows[1] else { return XCTFail("the fold") }
        XCTAssertEqual(folded.map(\.outcome), [.accepted, .unknown])
        guard case .words(_, let speaker, _, _, _) = rows.rows[2] else { return XCTFail("Luke's words") }
        XCTAssertEqual(speaker, .own)
        guard case .details(_, let items) = rows.rows[3] else { return XCTFail("the details") }
        XCTAssertEqual(items.count, 1)
        guard case .refusedAction(let toolCallId, let refused) = items[0] else { return XCTFail("the refusal") }
        XCTAssertEqual(toolCallId, "call_4a0000000000000002")
        XCTAssertEqual(refused.outcome, .refused)
    }

    func testARunningTurnIsPending() throws {
        XCTAssertTrue(ConversationTurnRows(group: try actedGroup(status: .running), roster: []).pending)
        XCTAssertTrue(ConversationTurnRows(group: try actedGroup(status: .queued), roster: []).pending)
        XCTAssertFalse(ConversationTurnRows(group: try actedGroup(status: .failed), roster: []).pending)
    }

    func testJudgmentFollowsTheTurnsOrigin() {
        func turn(_ origin: TurnOrigin) -> ConversationViewTurn {
            ConversationViewTurn(id: "t", origin: origin, status: .settled, queuedAt: Date())
        }
        XCTAssertEqual(ConversationTurnRows.judgment(of: turn(.typed)), .ask)
        XCTAssertEqual(ConversationTurnRows.judgment(of: turn(.spoken)), .ask)
        XCTAssertEqual(ConversationTurnRows.judgment(of: turn(.rosterDiff)), .own)
        XCTAssertEqual(ConversationTurnRows.judgment(of: turn(.holdRelease)), .own)
        XCTAssertEqual(ConversationTurnRows.judgment(of: turn(.child)), .own)
        XCTAssertEqual(ConversationTurnRows.judgment(of: nil), .ask)
        XCTAssertFalse(ConversationTurnRows.pending(nil))
    }

    func testAFoldFollowsTheTurnUntilTheReaderPressesUnderTheSameState() {
        XCTAssertTrue(ConversationTurnRows.foldOpen(choice: nil, pending: true))
        XCTAssertFalse(ConversationTurnRows.foldOpen(choice: nil, pending: false))
        let closedWhileRunning = ConversationFoldChoice(pending: true, open: false)
        XCTAssertFalse(ConversationTurnRows.foldOpen(choice: closedWhileRunning, pending: true))
        XCTAssertFalse(ConversationTurnRows.foldOpen(choice: closedWhileRunning, pending: false))
        let openedWhileSettled = ConversationFoldChoice(pending: false, open: true)
        XCTAssertTrue(ConversationTurnRows.foldOpen(choice: openedWhileSettled, pending: false))
        XCTAssertTrue(ConversationTurnRows.foldOpen(choice: openedWhileSettled, pending: true))
    }

    func testAToolTheViewDidNotDescribeAndANonSessionActionAreDetails() {
        let read = ToolPart(toolName: "read_transcript", toolCallId: "c1", state: .outputAvailable, input: .object([:]), output: .object([:]))
        let remember = ToolPart(toolName: "remember_fact", toolCallId: "c2", state: .outputAvailable, input: .object([:]), output: .object(["status": .string("accepted")]))
        let message = UIMessage(
            id: "m", attribution: .assistant(AssistantMessageMetadata(author: .brain)),
            parts: [.tool(read), .tool(remember), .text("Noted.")]
        )
        let group = ConversationReadTurnGroup(
            turnId: "t", conversationId: "c", source: .main,
            turn: ConversationViewTurn(id: "t", origin: .typed, status: .settled, queuedAt: Date(timeIntervalSince1970: 1)),
            messages: [
                ConversationReadMessage(
                    message: message, seq: 1, createdAt: Date(timeIntervalSince1970: 1),
                    tools: [
                        .detail(ToolPartIdentity(toolCallId: "c1", toolName: "read_transcript", state: .outputAvailable)),
                        .action(ToolPartIdentity(toolCallId: "c2", toolName: "remember_fact", state: .outputAvailable), outcome: .accepted),
                    ]
                ),
            ]
        )
        let rows = ConversationTurnRows(group: group, roster: [])
        XCTAssertEqual(rows.rows.count, 2)
        guard case .words(_, let speaker, _, _, _) = rows.rows[0] else { return XCTFail("the words") }
        XCTAssertEqual(speaker, .luke)
        guard case .details(_, let items) = rows.rows[1] else { return XCTFail("the details") }
        XCTAssertEqual(items, [.tool(read), .tool(remember)])
    }

    func testAUserNoteTheBrainWroteIsNotTheDevelopersVoice() {
        let note = UIMessage(id: "n", attribution: .user(.observation(.rosterLook)), parts: [.text("Two sessions are working.")])
        let group = ConversationReadTurnGroup(
            turnId: "t", conversationId: "c", source: .main, turn: nil,
            messages: [ConversationReadMessage(message: note, seq: 1, createdAt: Date(timeIntervalSince1970: 1), tools: [])]
        )
        guard case .words(_, let speaker, _, _, _) = ConversationTurnRows(group: group, roster: []).rows[0] else {
            return XCTFail("the note")
        }
        XCTAssertEqual(speaker, .note)
    }
}
