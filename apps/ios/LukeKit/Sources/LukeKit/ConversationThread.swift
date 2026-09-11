import Foundation

/// The Conversation as one device holds it: what the per-resource reads have
/// answered so far, merged under the contract `reads-wire.ts` states. Groups
/// merge by turn id and messages by sequence, so a row still being written —
/// answered on every read until it is finished — replaces the copy held
/// rather than standing beside it; the rows of a conversation an answer no
/// longer lists are dropped, which is how a Clear reaches a screen that drew
/// them; a turn is replaced by id as its stamps move; and the latest speech
/// event on an announcement decides whether it reads as unspoken. The three
/// cursors are the strings the service minted, echoed back on the next read
/// and never composed here. Every device that reads to the end holds the same
/// rows in the same order, because the order is the view's own: a group's
/// earliest message, then its turn's queue instant, then its id.
public struct ConversationThread: Equatable, Sendable {
    public private(set) var conversations: [ConversationReadConversation] = []
    public private(set) var messagesCursor: String?
    public private(set) var eventsCursor: String?
    public private(set) var turnsCursor: String?

    private var groups: [String: Group] = [:]
    private var latestSpeech: [String: SpeechMark] = [:]

    private struct Group: Equatable, Sendable {
        let turnId: String
        var conversationId: String
        var source: ConversationViewSource
        var turn: ConversationViewTurn?
        var messages: [Int: ConversationReadMessage]
    }

    /// The latest speech event a message has, by its conversation's own event sequence.
    private struct SpeechMark: Equatable, Sendable {
        let seq: Int
        let kind: ConversationEventKind
    }

    public init() {}

    /// Whether a messages read has answered at all, empty or not.
    public var opened: Bool { messagesCursor != nil }

    public mutating func apply(_ answer: ConversationMessagesAnswer) {
        conversations = answer.conversations
        let standing = Set(answer.conversations.map(\.id))
        groups = groups.filter { standing.contains($0.value.conversationId) }
        for group in answer.groups {
            var merged = groups[group.turnId]
                ?? Group(
                    turnId: group.turnId,
                    conversationId: group.conversationId,
                    source: group.source,
                    turn: nil,
                    messages: [:]
                )
            merged.conversationId = group.conversationId
            merged.source = group.source
            if let turn = group.turn { merged.turn = turn }
            for message in group.messages { merged.messages[message.seq] = message }
            groups[group.turnId] = merged
        }
        let held = Set(groups.values.flatMap { $0.messages.values.map(\.message.id) })
        latestSpeech = latestSpeech.filter { held.contains($0.key) }
        messagesCursor = answer.next
    }

    public mutating func apply(_ answer: BrainTurnsAnswer) {
        for record in answer.turns {
            groups[record.turn.id]?.turn = record.turn
        }
        if let next = answer.next { turnsCursor = next }
    }

    public mutating func apply(_ answer: ConversationEventsAnswer) {
        for event in answer.events where event.kind.isSpeech {
            let standing = latestSpeech[event.messageId]
            if standing == nil || standing!.seq < event.seq {
                latestSpeech[event.messageId] = SpeechMark(seq: event.seq, kind: event.kind)
            }
        }
        eventsCursor = answer.next
    }

    /// Takes the change signal's heads for the turns and events, for a
    /// device that has read nothing yet: the messages read that follows folds
    /// every event and turn up to the moment it runs, so those two start from
    /// where they stand rather than from the beginning of the record. A
    /// device already holding messages adopts nothing — a mark or a stamp
    /// that moved since its last read is only found by reading — and a
    /// resource already read keeps its own cursor.
    public mutating func adoptHeads(from changes: ChangesAnswer) {
        guard messagesCursor == nil else { return }
        if eventsCursor == nil { eventsCursor = changes.events }
        if turnsCursor == nil, let turns = changes.turns { turnsCursor = turns }
    }

    /// The turn groups in the view's order, each message's tool decisions
    /// amended by the speech events read since.
    public var turnGroups: [ConversationReadTurnGroup] {
        let placed = groups.values.map { group -> (ConversationReadTurnGroup, Date) in
            let messages = group.messages.values
                .sorted { $0.seq < $1.seq }
                .map(amended)
            let earliest = messages.map(\.createdAt).min() ?? .distantFuture
            return (
                ConversationReadTurnGroup(
                    turnId: group.turnId,
                    conversationId: group.conversationId,
                    source: group.source,
                    turn: group.turn,
                    messages: messages
                ),
                earliest
            )
        }
        return placed.sorted { a, b in
            if a.1 != b.1 { return a.1 < b.1 }
            let queuedA = a.0.turn?.queuedAt ?? .distantFuture
            let queuedB = b.0.turn?.queuedAt ?? .distantFuture
            if queuedA != queuedB { return queuedA < queuedB }
            return a.0.turnId.unicodeScalars.lexicographicallyPrecedes(b.0.turnId.unicodeScalars)
        }.map(\.0)
    }

    private func amended(_ message: ConversationReadMessage) -> ConversationReadMessage {
        guard let mark = latestSpeech[message.message.id] else { return message }
        let tools = message.tools.map { tool -> ConversationViewToolPart in
            if case .announce(let identity, _) = tool {
                return .announce(identity, unspoken: mark.kind == .speechExpired)
            }
            return tool
        }
        return ConversationReadMessage(
            message: message.message, seq: message.seq, createdAt: message.createdAt, tools: tools
        )
    }
}
