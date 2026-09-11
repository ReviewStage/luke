import Foundation
import XCTest

@testable import LukeKit

/// The merge contract the messages cursor sets: a row still being written is
/// answered again until finished and replaces the copy held, a conversation
/// no longer listed takes its rows with it, a turn is replaced by id, and the
/// latest speech event decides an announcement's mark.
final class ConversationThreadTests: XCTestCase {
    private static let main = "3c000000-0000-4000-8000-000000000001"
    private static let observed = "3c000000-0000-4000-8000-000000000002"

    private func fixtureAnswer() throws -> ConversationMessagesAnswer {
        try JSONDecoder().decode(
            ConversationMessagesAnswer.self,
            from: RepositoryFixtures.data(RepositoryFixtures.reads, "conversation-messages-answer.json")
        )
    }

    private func reply(id: String, parts: [UIMessagePart]) -> UIMessage {
        UIMessage(id: id, attribution: .assistant(AssistantMessageMetadata(author: .brain)), parts: parts)
    }

    private func turn(_ id: String, origin: TurnOrigin = .typed, status: TurnStatus, queuedAt: TimeInterval) -> ConversationViewTurn {
        ConversationViewTurn(id: id, origin: origin, status: status, queuedAt: Date(timeIntervalSince1970: queuedAt))
    }

    private func group(
        turnId: String,
        conversationId: String = ConversationThreadTests.main,
        turn: ConversationViewTurn?,
        messages: [ConversationReadMessage]
    ) -> ConversationReadTurnGroup {
        ConversationReadTurnGroup(
            turnId: turnId, conversationId: conversationId, source: .main, turn: turn, messages: messages
        )
    }

    private func row(_ id: String, seq: Int, at: TimeInterval, parts: [UIMessagePart] = [.text("words")]) -> ConversationReadMessage {
        ConversationReadMessage(
            message: reply(id: id, parts: parts), seq: seq, createdAt: Date(timeIntervalSince1970: at), tools: []
        )
    }

    private let mainOnly = [ConversationReadConversation(id: ConversationThreadTests.main, source: .main)]

    func testTheFixtureAnswerStandsAsItsGroupsInOrder() throws {
        var thread = ConversationThread()
        XCTAssertFalse(thread.opened)
        let answer = try fixtureAnswer()
        thread.apply(answer)
        XCTAssertTrue(thread.opened)
        XCTAssertEqual(thread.messagesCursor, answer.next)
        XCTAssertEqual(thread.conversations, answer.conversations)
        XCTAssertEqual(thread.turnGroups, answer.groups)
    }

    func testAnUnfinishedRowIsReplacedBySequenceRatherThanAppended() {
        var thread = ConversationThread()
        let running = turn("t1", status: .running, queuedAt: 100)
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly,
                groups: [group(turnId: "t1", turn: running, messages: [row("m1", seq: 1, at: 100, parts: [.text("Sen")])])],
                next: "c1",
                hasMore: false
            )
        )
        let settled = turn("t1", status: .settled, queuedAt: 100)
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly,
                groups: [
                    group(
                        turnId: "t1",
                        turn: settled,
                        messages: [
                            row("m1", seq: 1, at: 100, parts: [.text("Sent."), .stepStart]),
                            row("m2", seq: 2, at: 101),
                        ]
                    ),
                ],
                next: "c2",
                hasMore: false
            )
        )
        let groups = thread.turnGroups
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].messages.map(\.seq), [1, 2])
        XCTAssertEqual(groups[0].messages[0].message.parts, [.text("Sent."), .stepStart])
        XCTAssertEqual(groups[0].turn?.status, .settled)
        XCTAssertEqual(thread.messagesCursor, "c2")
    }

    func testAGroupContinuedOnALaterPageKeepsItsEarlierTurnRow() {
        var thread = ConversationThread()
        let queued = turn("t1", status: .queued, queuedAt: 100)
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly,
                groups: [group(turnId: "t1", turn: queued, messages: [row("m1", seq: 1, at: 100)])],
                next: "c1",
                hasMore: true
            )
        )
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly,
                groups: [group(turnId: "t1", turn: nil, messages: [row("m2", seq: 2, at: 101)])],
                next: "c2",
                hasMore: false
            )
        )
        XCTAssertEqual(thread.turnGroups[0].turn, queued)
        XCTAssertEqual(thread.turnGroups[0].messages.map(\.seq), [1, 2])
    }

    func testRowsOfAConversationNoLongerListedAreDropped() {
        var thread = ConversationThread()
        let both = mainOnly + [
            ConversationReadConversation(
                id: Self.observed,
                source: .observed(SessionIdentity(providerId: "conductor", providerSessionId: "s"))
            ),
        ]
        thread.apply(
            ConversationMessagesAnswer(
                conversations: both,
                groups: [
                    group(turnId: "t1", turn: nil, messages: [row("m1", seq: 1, at: 100)]),
                    group(turnId: "t2", conversationId: Self.observed, turn: nil, messages: [row("m2", seq: 7, at: 200)]),
                ],
                next: "c1",
                hasMore: false
            )
        )
        XCTAssertEqual(thread.turnGroups.map(\.turnId), ["t1", "t2"])
        thread.apply(ConversationMessagesAnswer(conversations: mainOnly, groups: [], next: "c2", hasMore: false))
        XCTAssertEqual(thread.turnGroups.map(\.turnId), ["t1"])
        XCTAssertEqual(thread.conversations, mainOnly)
    }

    func testGroupsOrderByEarliestMessageThenQueueInstantThenId() {
        var thread = ConversationThread()
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly,
                groups: [
                    group(turnId: "t-b", turn: turn("t-b", status: .settled, queuedAt: 50), messages: [row("m3", seq: 3, at: 300)]),
                    group(turnId: "t-c", turn: turn("t-c", status: .settled, queuedAt: 40), messages: [row("m4", seq: 4, at: 300)]),
                    group(turnId: "t-a", turn: nil, messages: [row("m1", seq: 1, at: 100), row("m2", seq: 2, at: 400)]),
                    group(turnId: "t-e", turn: nil, messages: [row("m6", seq: 6, at: 300)]),
                    group(turnId: "t-d", turn: nil, messages: [row("m5", seq: 5, at: 300)]),
                ],
                next: "c1",
                hasMore: false
            )
        )
        XCTAssertEqual(thread.turnGroups.map(\.turnId), ["t-a", "t-c", "t-b", "t-d", "t-e"])
    }

    func testATurnAnswerReplacesTheTurnByIdAndMovesItsCursor() {
        var thread = ConversationThread()
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly,
                groups: [group(turnId: "t1", turn: turn("t1", status: .running, queuedAt: 100), messages: [row("m1", seq: 1, at: 100)])],
                next: "c1",
                hasMore: false
            )
        )
        let settled = turn("t1", status: .settled, queuedAt: 100)
        thread.apply(
            BrainTurnsAnswer(
                turns: [
                    BrainTurnRecord(turn: settled, conversationId: Self.main, cursor: "tc1"),
                    BrainTurnRecord(turn: turn("t9", status: .queued, queuedAt: 900), conversationId: Self.main, cursor: "tc2"),
                ],
                next: "tc2",
                hasMore: false
            )
        )
        XCTAssertEqual(thread.turnGroups.map(\.turnId), ["t1"])
        XCTAssertEqual(thread.turnGroups[0].turn, settled)
        XCTAssertEqual(thread.turnsCursor, "tc2")
        thread.apply(BrainTurnsAnswer(turns: [], next: nil, hasMore: false))
        XCTAssertEqual(thread.turnsCursor, "tc2")
    }

    func testTheLatestSpeechEventDecidesWhetherABriefingReadsUnspoken() {
        var thread = ConversationThread()
        let identity = ToolPartIdentity(toolCallId: "c1", toolName: "announce", state: .outputAvailable)
        let announcement = ConversationReadMessage(
            message: reply(
                id: "m1",
                parts: [.tool(ToolPart(toolName: "announce", toolCallId: "c1", state: .outputAvailable, input: .object(["briefing": .string("Hi")])))]
            ),
            seq: 1,
            createdAt: Date(timeIntervalSince1970: 100),
            tools: [.announce(identity, unspoken: false)]
        )
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly, groups: [group(turnId: "t1", turn: nil, messages: [announcement])], next: "c1", hasMore: false
            )
        )
        func event(_ seq: Int, _ kind: ConversationEventKind) -> ConversationReadEvent {
            ConversationReadEvent(
                id: "e\(seq)", conversationId: Self.main, seq: seq, messageId: "m1", kind: kind,
                createdAt: Date(timeIntervalSince1970: 100 + Double(seq))
            )
        }
        thread.apply(ConversationEventsAnswer(events: [event(1, .speechOffered), event(2, .speechExpired)], next: "e2", hasMore: false))
        XCTAssertEqual(thread.turnGroups[0].messages[0].tools, [.announce(identity, unspoken: true)])
        XCTAssertEqual(thread.eventsCursor, "e2")
        thread.apply(ConversationEventsAnswer(events: [event(3, .speechSpoken), event(4, .rating)], next: "e4", hasMore: false))
        XCTAssertEqual(thread.turnGroups[0].messages[0].tools, [.announce(identity, unspoken: false)])
        thread.apply(ConversationEventsAnswer(events: [event(2, .speechExpired)], next: "e4", hasMore: false))
        XCTAssertEqual(thread.turnGroups[0].messages[0].tools, [.announce(identity, unspoken: false)])
    }

    func testAReplayStillPagingLeavesTheFoldedSpeechMarksStanding() {
        var thread = ConversationThread()
        let identity = ToolPartIdentity(toolCallId: "c1", toolName: "announce", state: .outputAvailable)
        let announcement = ConversationReadMessage(
            message: reply(
                id: "m1",
                parts: [.tool(ToolPart(toolName: "announce", toolCallId: "c1", state: .outputAvailable, input: .object(["briefing": .string("Hi")])))]
            ),
            seq: 1,
            createdAt: Date(timeIntervalSince1970: 100),
            tools: [.announce(identity, unspoken: true)]
        )
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly, groups: [group(turnId: "t1", turn: nil, messages: [announcement])], next: "c1", hasMore: false
            )
        )
        func event(_ seq: Int, _ kind: ConversationEventKind) -> ConversationReadEvent {
            ConversationReadEvent(
                id: "e\(seq)", conversationId: Self.main, seq: seq, messageId: "m1", kind: kind,
                createdAt: Date(timeIntervalSince1970: 100 + Double(seq))
            )
        }
        thread.apply(ConversationEventsAnswer(events: [event(1, .speechOffered)], next: "e1", hasMore: true))
        XCTAssertEqual(thread.turnGroups[0].messages[0].tools, [.announce(identity, unspoken: true)])
        thread.apply(ConversationEventsAnswer(events: [event(2, .speechExpired)], next: "e2", hasMore: false))
        XCTAssertEqual(thread.turnGroups[0].messages[0].tools, [.announce(identity, unspoken: true)])
        thread.apply(ConversationEventsAnswer(events: [event(3, .speechSpoken)], next: "e3", hasMore: true))
        XCTAssertEqual(thread.turnGroups[0].messages[0].tools, [.announce(identity, unspoken: false)])
    }

    func testTheSignalsHeadsSeedTheTurnsAndEventsOfAThreadThatHoldsNothingAndNeverTheMessages() {
        var thread = ConversationThread()
        thread.adoptHeads(from: ChangesAnswer(seen: true, messages: "m1", events: "e1", turns: "t1"))
        XCTAssertNil(thread.messagesCursor)
        XCTAssertEqual(thread.eventsCursor, "e1")
        XCTAssertEqual(thread.turnsCursor, "t1")
        thread.adoptHeads(from: ChangesAnswer(seen: true, messages: "m2", events: "e2", turns: "t2"))
        XCTAssertEqual(thread.eventsCursor, "e1")
        XCTAssertEqual(thread.turnsCursor, "t1")
        var fresh = ConversationThread()
        fresh.adoptHeads(from: ChangesAnswer(seen: true, messages: "m1", events: "e1", turns: nil))
        XCTAssertNil(fresh.turnsCursor)
        XCTAssertEqual(fresh.eventsCursor, "e1")
        fresh.apply(ConversationMessagesAnswer(conversations: mainOnly, groups: [], next: "m1", hasMore: false))
        fresh.adoptHeads(from: ChangesAnswer(seen: true, messages: "m1", events: "e2", turns: "t2"))
        XCTAssertEqual(fresh.eventsCursor, "e1")
        XCTAssertNil(fresh.turnsCursor)
    }

    func testTheFixtureAnswerFoldsTheRatingOntoItsMessage() throws {
        var thread = ConversationThread()
        thread.apply(try fixtureAnswer())
        XCTAssertEqual(thread.ratings, ["2b000000-0000-4000-8000-000000000032": .up])
    }

    func testAFoldedRatingIsAmendedByANewerEventOnceTheEventsStandAtTheFold() {
        var thread = ConversationThread()
        let rated = ConversationReadMessage(
            message: reply(id: "m1", parts: [.text("words")]),
            seq: 1,
            createdAt: Date(timeIntervalSince1970: 100),
            tools: [],
            rating: RatingEventPayload(rating: .up)
        )
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly, groups: [group(turnId: "t1", turn: nil, messages: [rated])], next: "c1", hasMore: false
            )
        )
        XCTAssertEqual(thread.ratings, ["m1": .up])
        thread.apply(ConversationEventsAnswer(events: [ratingEvent(1, "down")], next: "e1", hasMore: true))
        XCTAssertEqual(thread.ratings, ["m1": .up])
        thread.apply(ConversationEventsAnswer(events: [], next: "e1", hasMore: false))
        XCTAssertEqual(thread.ratings, ["m1": .down])

        var unread = ConversationThread()
        unread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly, groups: [group(turnId: "t1", turn: nil, messages: [rated])], next: "c1", hasMore: false
            )
        )
        unread.record(ratingEvent(2, "down"))
        XCTAssertEqual(unread.ratings, ["m1": .down])

        var seeded = ConversationThread()
        seeded.adoptHeads(from: ChangesAnswer(seen: true, messages: "m1", events: "e1", turns: nil))
        seeded.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly, groups: [group(turnId: "t1", turn: nil, messages: [rated])], next: "c1", hasMore: false
            )
        )
        seeded.record(ratingEvent(2, "down"))
        XCTAssertEqual(seeded.ratings, ["m1": .down])
    }

    private func ratingEvent(_ seq: Int, _ rating: String?, messageId: String = "m1") -> ConversationReadEvent {
        ConversationReadEvent(
            id: "r\(seq)", conversationId: Self.main, seq: seq, messageId: messageId, kind: .rating,
            deviceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
            payload: rating.map { .object(["rating": .string($0)]) } ?? .object([:]),
            createdAt: Date(timeIntervalSince1970: 100 + Double(seq))
        )
    }

    func testTheLatestRatingEventIsTheMessagesVerdict() {
        var thread = ConversationThread()
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly,
                groups: [group(turnId: "t1", turn: nil, messages: [row("m1", seq: 1, at: 100), row("m2", seq: 2, at: 101)])],
                next: "c1",
                hasMore: false
            )
        )
        XCTAssertEqual(thread.ratings, [:])
        thread.apply(ConversationEventsAnswer(events: [ratingEvent(1, "up"), ratingEvent(2, "down")], next: "e2", hasMore: false))
        XCTAssertEqual(thread.ratings, ["m1": .down])
        thread.apply(ConversationEventsAnswer(events: [ratingEvent(1, "up")], next: "e2", hasMore: false))
        XCTAssertEqual(thread.ratings, ["m1": .down])
        thread.apply(ConversationEventsAnswer(events: [ratingEvent(3, "sideways"), ratingEvent(4, nil)], next: "e4", hasMore: false))
        XCTAssertEqual(thread.ratings, ["m1": .down])
        thread.record(ratingEvent(5, "up", messageId: "m2"))
        XCTAssertEqual(thread.ratings, ["m1": .down, "m2": .up])
        XCTAssertEqual(thread.eventsCursor, "e4")
    }

    func testARatingLeavesWithTheConversationThatHeldItsMessage() {
        var thread = ConversationThread()
        thread.apply(
            ConversationMessagesAnswer(
                conversations: mainOnly,
                groups: [group(turnId: "t1", turn: nil, messages: [row("m1", seq: 1, at: 100)])],
                next: "c1",
                hasMore: false
            )
        )
        thread.record(ratingEvent(1, "up"))
        XCTAssertEqual(thread.ratings, ["m1": .up])
        thread.apply(ConversationMessagesAnswer(conversations: [], groups: [], next: "c2", hasMore: false))
        XCTAssertEqual(thread.ratings, [:])
    }

    func testAThreadReadWithoutASignalAdoptsNoHeadLater() {
        var thread = ConversationThread()
        thread.apply(ConversationMessagesAnswer(conversations: mainOnly, groups: [], next: "m1", hasMore: false))
        thread.adoptHeads(from: ChangesAnswer(seen: true, messages: "m1", events: "e1", turns: "t1"))
        XCTAssertNil(thread.eventsCursor)
        XCTAssertNil(thread.turnsCursor)
    }
}
