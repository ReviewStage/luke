import Foundation
import XCTest

@testable import LukeKit

/// The stored-message fixtures from A1, decoded as the bytes on disk. Each
/// case asserts the values the fixture carries, so a drift in either
/// language's reading of the same file fails here.
final class UIMessageFixtureTests: XCTestCase {
    private let decoder = JSONDecoder()

    private func message(_ name: String) throws -> UIMessage {
        try decoder.decode(UIMessage.self, from: RepositoryFixtures.data(RepositoryFixtures.uiMessages, name))
    }

    func testEveryStoredMessageFixtureDecodes() throws {
        let names = try RepositoryFixtures.names(in: RepositoryFixtures.uiMessages)
        XCTAssertEqual(names.count, 11)
        for name in names {
            XCTAssertNoThrow(try message(name), name)
        }
    }

    func testEveryConversationViewFixtureMessageDecodes() throws {
        let names = try RepositoryFixtures.names(in: RepositoryFixtures.conversationView)
        XCTAssertEqual(names.count, 6)
        var decoded = 0
        for name in names {
            let view = try RepositoryFixtures.json(RepositoryFixtures.conversationView, name)
            var rows = try XCTUnwrap(view["main"] as? [[String: Any]])
            for observed in try XCTUnwrap(view["observed"] as? [[String: Any]]) {
                rows += try XCTUnwrap(observed["messages"] as? [[String: Any]])
            }
            for row in rows {
                let bytes = try JSONSerialization.data(withJSONObject: try XCTUnwrap(row["message"]))
                XCTAssertNoThrow(try decoder.decode(UIMessage.self, from: bytes), name)
                decoded += 1
            }
        }
        XCTAssertGreaterThan(decoded, 0)
    }

    func testSpokenAskCarriesItsSpan() throws {
        let ask = try message("spoken-ask.json")
        XCTAssertEqual(ask.id, "3f1c9a2e-7b4d-4e8f-9a01-2b3c4d5e6f70")
        XCTAssertEqual(
            ask.attribution,
            .user(
                .spokenAsk(
                    SpokenAskMetadata(
                        author: .developer,
                        voiceSessionId: "vs_0f3a1c226f104d5e",
                        delegationId: "dl_2b8c4d5e6f701a2b",
                        fromMs: 1200,
                        toMs: 4800
                    )
                )
            )
        )
        XCTAssertEqual(ask.parts, [.text("What is the fixture session waiting on?")])
    }

    func testObservationSourcesAreTheirFixtures() throws {
        let sources: [String: ObservationSource] = [
            "observation-hook.json": .hook,
            "observation-roster-look.json": .rosterLook,
            "hold-release.json": .holdRelease,
            "child-task.json": .child,
            "child-completion.json": .childCompletion,
            "recalled-notes.json": .recalledNotes,
            "activity-notices.json": .activityNotices,
        ]
        for (name, source) in sources {
            let note = try message(name)
            XCTAssertEqual(note.attribution, .user(.observation(source)), name)
            XCTAssertEqual(note.parts.count, 1, name)
        }
    }

    func testCompactionFixturesNameWhatTheyFolded() throws {
        let counted = try message("compaction.json")
        XCTAssertEqual(
            counted.attribution,
            .assistant(
                AssistantMessageMetadata(
                    author: .brain,
                    compaction: CompactionMetadata(
                        firstKeptMessageId: "5a2d7b3c-8e4f-4a9b-8c12-3d4e5f6a7b81", tokensBefore: 48210
                    )
                )
            )
        )
        let uncounted = try message("compaction-uncounted.json")
        guard case .assistant(let metadata) = uncounted.attribution else {
            return XCTFail("an assistant row")
        }
        XCTAssertEqual(metadata.compaction?.tokensBefore, nil)
        XCTAssertEqual(metadata.compaction?.firstKeptMessageId, "5a2d7b3c-8e4f-4a9b-8c12-3d4e5f6a7b81")
    }

    func testReplyWithToolPartKeepsEveryPartInOrder() throws {
        let reply = try message("reply-with-tool-part.json")
        XCTAssertEqual(reply.attribution, .assistant(AssistantMessageMetadata(author: .brain)))
        XCTAssertEqual(reply.parts.count, 4)
        XCTAssertEqual(reply.parts[0], .stepStart)
        guard case .reasoning(let thought) = reply.parts[1] else { return XCTFail("a reasoning part") }
        XCTAssertFalse(thought.isEmpty)
        let tool = try XCTUnwrap(reply.toolParts.first)
        XCTAssertEqual(reply.toolParts.count, 1)
        XCTAssertEqual(tool.toolName, "read_transcript")
        XCTAssertEqual(tool.toolCallId, "call_6f10d4e59a712b8c")
        XCTAssertEqual(tool.state, .outputAvailable)
        XCTAssertEqual(tool.input?["providerId"], .string("conductor"))
        XCTAssertEqual(tool.output?["lines"]?.arrayValue?.count, 2)
        XCTAssertNil(tool.errorText)
        guard case .text = reply.parts[3] else { return XCTFail("a text part") }
    }

    func testObservationActedFixtureCarriesThreeToolStates() throws {
        let view = try RepositoryFixtures.json(RepositoryFixtures.conversationView, "observation-acted.json")
        let observed = try XCTUnwrap((view["observed"] as? [[String: Any]])?.first)
        let rows = try XCTUnwrap(observed["messages"] as? [[String: Any]])
        let bytes = try JSONSerialization.data(withJSONObject: try XCTUnwrap(rows[1]["message"]))
        let reply = try decoder.decode(UIMessage.self, from: bytes)
        XCTAssertEqual(reply.toolParts.map(\.state), [.outputAvailable, .outputError, .outputAvailable])
        XCTAssertEqual(reply.toolParts[1].errorText, "The control is no longer advertised.")
        XCTAssertEqual(reply.toolParts[2].output?["status"], .string("unknown"))
    }

    // MARK: - Refusals

    private func decode(_ json: String) throws -> UIMessage {
        try decoder.decode(UIMessage.self, from: Data(json.utf8))
    }

    func testAToolStateOutsideTheStoredSetRefusesTheMessage() {
        XCTAssertThrowsError(
            try decode(
                """
                {"id":"m","role":"assistant","metadata":{"author":"brain"},"parts":[
                  {"type":"tool-announce","toolCallId":"c","state":"approval-requested","input":{}}]}
                """
            )
        )
    }

    func testADynamicToolPartRefusesTheMessage() {
        XCTAssertThrowsError(
            try decode(
                """
                {"id":"m","role":"assistant","metadata":{"author":"brain"},"parts":[
                  {"type":"dynamic-tool","toolName":"x","toolCallId":"c","state":"output-available","input":{},"output":{}}]}
                """
            )
        )
    }

    func testASystemRowWithMetadataIsRefused() {
        XCTAssertThrowsError(
            try decode(#"{"id":"m","role":"system","metadata":{},"parts":[{"type":"text","text":"x"}]}"#)
        )
        XCTAssertNoThrow(try decode(#"{"id":"m","role":"system","parts":[{"type":"text","text":"x"}]}"#))
    }

    func testAUserRowNeedsAnAskOrAnObservation() {
        XCTAssertThrowsError(try decode(#"{"id":"m","role":"user","parts":[{"type":"text","text":"x"}]}"#))
        XCTAssertThrowsError(
            try decode(#"{"id":"m","role":"user","metadata":{"author":"brain","channel":"typed"},"parts":[]}"#)
        )
        XCTAssertThrowsError(
            try decode(
                #"{"id":"m","role":"user","metadata":{"author":"developer","channel":"voice","from_ms":5,"to_ms":1},"parts":[]}"#
            )
        )
        XCTAssertThrowsError(
            try decode(
                #"{"id":"m","role":"user","metadata":{"author":"developer","channel":"voice","from_ms":5},"parts":[]}"#
            )
        )
    }

    func testAnAssistantRowNeedsALukeAuthor() {
        XCTAssertThrowsError(
            try decode(#"{"id":"m","role":"assistant","metadata":{"author":"developer"},"parts":[]}"#)
        )
        XCTAssertNoThrow(try decode(#"{"id":"m","role":"assistant","metadata":{"author":"child"},"parts":[]}"#))
    }

    func testAPartTypeThisBuildDoesNotDrawIsKeptByItsType() throws {
        let message = try decode(
            #"{"id":"m","role":"assistant","metadata":{"author":"brain"},"parts":[{"type":"file","url":"x","mediaType":"text/plain"}]}"#
        )
        XCTAssertEqual(message.parts, [.other(type: "file")])
    }
}
