import Foundation
import XCTest

@testable import LukeKit

/// An action's row, composed from the call's arguments and its envelope,
/// with the roster supplying only a session it still holds. What is
/// asserted is the structure the desktop shares — kind, outcome, the chip
/// and who names it, the reason — never the phone's own sentence.
final class ConversationToolRowTests: XCTestCase {
    private static let session = SessionIdentity(
        providerId: "conductor", providerSessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50"
    )

    private var identityArguments: [String: JSONValue] {
        [
            "provider_id": .string(Self.session.providerId),
            "provider_session_id": .string(Self.session.providerSessionId),
        ]
    }

    private func part(
        _ tool: String,
        state: ToolPartState = .outputAvailable,
        input: [String: JSONValue]? = nil,
        output: JSONValue? = nil,
        errorText: String? = nil
    ) -> ToolPart {
        ToolPart(
            toolName: tool,
            toolCallId: "call",
            state: state,
            input: input.map(JSONValue.object) ?? .object(identityArguments),
            output: output,
            errorText: errorText
        )
    }

    private func accepted(target: [String: JSONValue]? = nil, extra: [String: JSONValue] = [:]) -> JSONValue {
        var envelope: [String: JSONValue] = ["status": .string("accepted")]
        envelope["target"] = target.map(JSONValue.object)
        for (key, value) in extra { envelope[key] = value }
        return .object(envelope)
    }

    private var fixtureTarget: [String: JSONValue] {
        [
            "providerId": .string("conductor"),
            "providerSessionId": .string(Self.session.providerSessionId),
            "title": .string("Fixture session"),
            "agentId": .string("fixture-agent"),
        ]
    }

    private let rosterRow = RosterSession(
        providerId: "conductor",
        sessionId: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
        title: "Renamed since",
        status: "working"
    )

    /// The fixture's three parts: accepted, errored, and unknown, as `observation-acted.json` holds them.
    private func fixtureReplyParts() throws -> [ToolPart] {
        let view = try RepositoryFixtures.json(RepositoryFixtures.conversationView, "observation-acted.json")
        let observed = try XCTUnwrap((view["observed"] as? [[String: Any]])?.first)
        let rows = try XCTUnwrap(observed["messages"] as? [[String: Any]])
        let bytes = try JSONSerialization.data(withJSONObject: try XCTUnwrap(rows[1]["message"]))
        return try JSONDecoder().decode(UIMessage.self, from: bytes).toolParts
    }

    func testTheFixturesThreeActionsReadAsTheirThreeOutcomes() throws {
        let parts = try fixtureReplyParts()
        let rows = try parts.map { try XCTUnwrap(ConversationToolRow(part: $0, roster: [])) }
        XCTAssertEqual(rows.map(\.kind), [.message, .control, .message])
        XCTAssertEqual(rows.map(\.outcome), [.accepted, .refused, .unknown])
        XCTAssertEqual(rows.map(\.reason), [nil, "The control is no longer advertised.", "The node's connection closed before it answered."])
        XCTAssertEqual(rows.map(\.providerId), ["conductor", "conductor", "conductor"])
        let chip = try XCTUnwrap(rows[0].chip)
        XCTAssertEqual(chip.text, "Fixture session")
        XCTAssertEqual(chip.markId, "fixture-agent")
        XCTAssertEqual(chip.identity, Self.session)
        XCTAssertFalse(chip.openable)
        XCTAssertEqual(rows[1].chip?.text, ConversationToolRow.unnamedSession)
        XCTAssertEqual(rows[1].chip?.markId, "conductor")
    }

    func testTheRosterNamesASessionItStillHoldsAndOffersItsScreen() throws {
        let parts = try fixtureReplyParts()
        let row = try XCTUnwrap(ConversationToolRow(part: parts[0], roster: [rosterRow]))
        let chip = try XCTUnwrap(row.chip)
        XCTAssertEqual(chip.text, "Renamed since")
        XCTAssertEqual(chip.markId, "conductor")
        XCTAssertEqual(chip.session, rosterRow)
        XCTAssertTrue(chip.openable)
    }

    func testAToolThatIsNotASessionActionDrawsNoRow() {
        XCTAssertNil(ConversationToolRow(part: part("read_transcript"), roster: []))
        XCTAssertNil(ConversationToolRow(part: part("remember_fact"), roster: []))
        XCTAssertNil(ConversationToolRow(part: part("announce"), roster: []))
    }

    func testACallStillUnderWayIsPending() throws {
        let row = try XCTUnwrap(ConversationToolRow(part: part("send_session_message", state: .inputAvailable), roster: []))
        XCTAssertEqual(row.outcome, .pending)
        XCTAssertNil(row.reason)
        XCTAssertEqual(row.chip?.identity, Self.session)
    }

    func testAnUnreadableEnvelopeIsUnknownNeverAccepted() throws {
        let row = try XCTUnwrap(
            ConversationToolRow(part: part("send_session_message", output: .object(["ok": .bool(true)])), roster: [])
        )
        XCTAssertEqual(row.outcome, .unknown)
        XCTAssertEqual(row.reason, ConversationToolRow.unreadableEnvelope)
    }

    func testARefusedEnvelopeCarriesItsReason() throws {
        let row = try XCTUnwrap(
            ConversationToolRow(
                part: part(
                    "rename_session",
                    input: identityArguments.merging(["name": .string("Checkout")]) { $1 },
                    output: .object(["status": .string("refused"), "reason": .string("Not advertised.")])
                ),
                roster: []
            )
        )
        XCTAssertEqual(row.kind, .renameSession)
        XCTAssertEqual(row.outcome, .refused)
        XCTAssertEqual(row.reason, "Not advertised.")
        XCTAssertEqual(row.runs.count, 3)
    }

    func testAnAcceptedEnvelopeCarriesItsNoteAndWarning() throws {
        let row = try XCTUnwrap(
            ConversationToolRow(
                part: part(
                    "send_session_message",
                    output: accepted(target: fixtureTarget, extra: ["note": .string("Queued."), "warning": .string("Slow.")])
                ),
                roster: []
            )
        )
        XCTAssertEqual(row.outcome, .accepted)
        XCTAssertEqual(row.note, "Queued.")
        XCTAssertEqual(row.warning, "Slow.")
        XCTAssertNil(row.reason)
    }

    func testAControlsMarkFollowsWhatItsAdapterSaidItDoes() throws {
        var target = fixtureTarget
        target["controlKind"] = .string("archive")
        target["controlLabel"] = .string("Archive")
        let row = try XCTUnwrap(
            ConversationToolRow(
                part: part("run_session_control", input: identityArguments.merging(["control_id": .string("archive")]) { $1 }, output: accepted(target: target)),
                roster: []
            )
        )
        XCTAssertEqual(row.kind, .control)
        XCTAssertEqual(row.controlKind, .archive)
        XCTAssertEqual(row.runs.count, 2)
        target["controlKind"] = .string("unheard-of")
        let plain = try XCTUnwrap(
            ConversationToolRow(part: part("run_session_control", output: accepted(target: target)), roster: [])
        )
        XCTAssertNil(plain.controlKind)
    }

    func testACreationNamesTheSessionItsAnswerNamed() throws {
        let created: [String: JSONValue] = ["providerId": .string("conductor"), "providerSessionId": .string("new-1")]
        let row = try XCTUnwrap(
            ConversationToolRow(
                part: part(
                    "create_workspace",
                    input: ["name": .string("Checkout"), "agent": .string("claude-code")],
                    output: accepted(target: ["providerId": .string("conductor")], extra: ["createdSession": .object(created)])
                ),
                roster: []
            )
        )
        XCTAssertEqual(row.kind, .createWorkspace)
        XCTAssertEqual(row.providerId, "conductor")
        let chip = try XCTUnwrap(row.chip)
        XCTAssertEqual(chip.identity, SessionIdentity(providerId: "conductor", providerSessionId: "new-1"))
        XCTAssertEqual(chip.text, "Checkout")
        XCTAssertEqual(chip.markId, "claude-code")
        XCTAssertFalse(chip.openable)
    }

    func testACreationWithNoNameAndNoAnswerHasNoChip() throws {
        let row = try XCTUnwrap(
            ConversationToolRow(part: part("create_workspace", state: .inputAvailable, input: [:]), roster: [])
        )
        XCTAssertNil(row.chip)
        XCTAssertNil(row.providerId)
        XCTAssertEqual(row.runs.count, 1)
    }

    func testEveryKindComposesAChipForItsSession() throws {
        let tools: [(String, ConversationActionKind)] = [
            ("send_session_message", .message),
            ("run_session_control", .control),
            ("open_session", .open),
            ("add_workspace_agent", .addAgent),
            ("rename_workspace", .renameWorkspace),
            ("rename_session", .renameSession),
        ]
        for (tool, kind) in tools {
            let row = try XCTUnwrap(ConversationToolRow(part: part(tool, output: accepted(target: fixtureTarget)), roster: []), tool)
            XCTAssertEqual(row.kind, kind, tool)
            XCTAssertEqual(row.chip?.identity, Self.session, tool)
            XCTAssertEqual(row.providerId, "conductor", tool)
        }
    }

    func testAnOpenNamesTheApplicationTheEnvelopeResolved() throws {
        var target = fixtureTarget
        target["applicationId"] = .string("cursor")
        let row = try XCTUnwrap(ConversationToolRow(part: part("open_session", output: accepted(target: target)), roster: []))
        XCTAssertEqual(row.runs.count, 3)
        let bare = try XCTUnwrap(ConversationToolRow(part: part("open_session", output: accepted(target: fixtureTarget)), roster: []))
        XCTAssertEqual(bare.runs.count, 2)
    }

    func testTheSentenceReadsTheChipsNameInItsPlace() throws {
        let row = try XCTUnwrap(
            ConversationToolRow(
                part: part("send_session_message", input: identityArguments.merging(["text": .string("Run the tests.")]) { $1 }, output: accepted(target: fixtureTarget)),
                roster: []
            )
        )
        XCTAssertEqual(row.runs.count, 3)
        XCTAssertEqual(row.sentence.count, row.runs.reduce(0) { total, run in
            switch run {
            case .text(let text): total + text.count
            case .chip(let chip): total + chip.text.count
            }
        })
    }
}
