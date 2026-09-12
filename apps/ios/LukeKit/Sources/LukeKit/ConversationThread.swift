import Foundation

/// The Conversation as one device holds it: what the per-resource reads have
/// answered so far, merged under the contract `reads-wire.ts` states. Groups
/// merge by turn id, and a message is held once, by its id, at the sequence
/// and in the group its latest delivery gave it: a row still being written —
/// answered on every read until it is finished — replaces the copy held
/// rather than standing beside it, and a row the store moved — a spoken line
/// taken into its turn, a turn's work placed behind the line it answers —
/// arrives again at a fresh sequence and leaves the place it held, a group
/// emptied that way going with it; the rows of a conversation an answer no
/// longer lists are dropped, which is how a Clear reaches a screen that drew
/// them; a turn is replaced by id as its stamps move; and the marks the
/// service folded onto each message — an announcement's unspoken mark, the
/// developer's latest rating — are amended by the newer events read since,
/// a second rating being a second event and never an edit. The three
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
    /// Where each message held stands, by its id: the one place a message has in this thread.
    private var places: [String: Place] = [:]
    private var latestSpeech: [String: SpeechMark] = [:]
    private var latestRating: [String: RatingMark] = [:]
    /// Whether the events read stands at or past the fold. The messages
    /// answer already folds every speech mark and rating up to the moment it
    /// was read, so while events are being replayed from their beginning the
    /// marks held here are older than that fold and stand behind it; once the
    /// replay has caught up — or the events cursor was seeded from the
    /// signal's head, with nothing older to replay — they carry everything
    /// the fold did and whatever came after, and only then do they amend it.
    private var eventsCaughtUp = false

    private struct Group: Equatable, Sendable {
        let turnId: String
        var conversationId: String
        var source: ConversationViewSource
        var turn: ConversationViewTurn?
        var messages: [Int: ConversationReadMessage]
    }

    /// The group holding a message and the sequence it is held at.
    private struct Place: Equatable, Sendable {
        let turnId: String
        let seq: Int
    }

    /// The latest speech event a message has, by its conversation's own event sequence.
    private struct SpeechMark: Equatable, Sendable {
        let seq: Int
        let kind: ConversationEventKind
    }

    /// The latest rating a message has, by the same sequence; a payload the
    /// wire does not spell a verdict in marks nothing. A mark this device wrote
    /// itself is newer than anything held or folded and amends at once; one
    /// read back from the events waits, like a speech mark, until the events
    /// read stands at or past the fold.
    private struct RatingMark: Equatable, Sendable {
        let seq: Int
        let rating: MessageRating
        let own: Bool
    }

    /// The key a rating event's verdict travels under in its payload — `RATING_EVENT_PAYLOAD_FIELDS`.
    private static let ratingPayloadKey = "rating"

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
            for message in group.messages {
                leavePlace(of: message.message.id, arrivingIn: group.turnId, at: message.seq, into: &merged)
                merged.messages[message.seq] = message
                places[message.message.id] = Place(turnId: group.turnId, seq: message.seq)
            }
            groups[group.turnId] = merged
        }
        let held = Set(groups.values.flatMap { $0.messages.values.map(\.message.id) })
        places = places.filter { held.contains($0.key) }
        latestSpeech = latestSpeech.filter { held.contains($0.key) }
        latestRating = latestRating.filter { held.contains($0.key) }
        messagesCursor = answer.next
    }

    /// A message arriving somewhere other than where it is held leaves the
    /// old place first, so it stands once: the store moved it, by taking a
    /// spoken line into its turn or by placing a turn's work behind the line
    /// it answers, and answered it again at a fresh sequence. A group left
    /// with nothing goes; the group being merged into is amended in place.
    private mutating func leavePlace(of messageId: String, arrivingIn turnId: String, at seq: Int, into merged: inout Group) {
        guard let held = places[messageId], held.turnId != turnId || held.seq != seq else { return }
        if held.turnId == turnId {
            merged.messages.removeValue(forKey: held.seq)
            return
        }
        groups[held.turnId]?.messages.removeValue(forKey: held.seq)
        if groups[held.turnId]?.messages.isEmpty == true { groups.removeValue(forKey: held.turnId) }
    }

    public mutating func apply(_ answer: BrainTurnsAnswer) {
        for record in answer.turns {
            groups[record.turn.id]?.turn = record.turn
        }
        if let next = answer.next { turnsCursor = next }
    }

    public mutating func apply(_ answer: ConversationEventsAnswer) {
        for event in answer.events { take(event, own: false) }
        eventsCursor = answer.next
        if !answer.hasMore { eventsCaughtUp = true }
    }

    /// Takes a rating this device just wrote, from the answer that recorded
    /// it, so the control shows the verdict before the next poll reads it
    /// back. Being this device's own write it is newer than anything held or
    /// folded, so it amends at once rather than waiting on the events read.
    public mutating func record(_ event: ConversationReadEvent) {
        take(event, own: true)
    }

    /// Takes one event as the latest word about its message where it is
    /// newer than the one held: a speech event moves the announcement's mark,
    /// a rating event the message's verdict.
    private mutating func take(_ event: ConversationReadEvent, own: Bool) {
        if event.kind.isSpeech {
            let standing = latestSpeech[event.messageId]
            if standing == nil || standing!.seq < event.seq {
                latestSpeech[event.messageId] = SpeechMark(seq: event.seq, kind: event.kind)
            }
            return
        }
        guard let rating = event.payload?[Self.ratingPayloadKey]?.stringValue.flatMap(MessageRating.init(rawValue:)) else {
            return
        }
        let standing = latestRating[event.messageId]
        if standing == nil || standing!.seq < event.seq {
            latestRating[event.messageId] = RatingMark(seq: event.seq, rating: rating, own: own)
        }
    }

    /// The developer's latest verdict on each message the thread holds: the
    /// rating the service folded onto the message, amended by a rating this
    /// device wrote since, and by the rating events read since once the events
    /// read stands at or past the fold.
    public var ratings: [String: MessageRating] {
        var verdicts: [String: MessageRating] = [:]
        for group in groups.values {
            for message in group.messages.values {
                if let rating = message.rating?.rating { verdicts[message.message.id] = rating }
            }
        }
        for (id, mark) in latestRating where eventsCaughtUp || mark.own {
            verdicts[id] = mark.rating
        }
        return verdicts
    }

    /// Takes the change signal's heads for the turns and the events, for a
    /// device that has read nothing yet: the messages read that follows
    /// carries every turn row as it then stands and folds every speech mark
    /// and rating up to the moment it is read, so both start from where they
    /// are rather than from the beginning of the record. An events read
    /// seeded this way has nothing older than the fold to replay, so its
    /// marks amend the fold at once. A device already holding anything
    /// adopts nothing — a stamp that moved since its last read is only found
    /// by reading — and a resource already read keeps its own cursor.
    public mutating func adoptHeads(from changes: ChangesAnswer) {
        guard messagesCursor == nil, turnsCursor == nil, eventsCursor == nil else { return }
        if let turns = changes.turns { turnsCursor = turns }
        eventsCursor = changes.events
        eventsCaughtUp = true
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
        guard eventsCaughtUp, let mark = latestSpeech[message.message.id] else { return message }
        let tools = message.tools.map { tool -> ConversationViewToolPart in
            if case .announce(let identity, _) = tool {
                return .announce(identity, unspoken: mark.kind == .speechExpired)
            }
            return tool
        }
        return ConversationReadMessage(
            message: message.message,
            seq: message.seq,
            createdAt: message.createdAt,
            tools: tools,
            rating: message.rating
        )
    }
}
