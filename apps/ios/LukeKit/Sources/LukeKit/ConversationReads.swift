import Foundation

/// A session named by its provider and the provider's own id for it —
/// `SessionIdentity` in `@sidecar/session`.
public struct SessionIdentity: Hashable, Sendable, Codable {
    public let providerId: String
    public let providerSessionId: String

    public init(providerId: String, providerSessionId: String) {
        self.providerId = providerId
        self.providerSessionId = providerSessionId
    }

    init?(json: JSONValue) {
        guard let providerId = json["providerId"]?.stringValue, !providerId.isEmpty,
              let providerSessionId = json["providerSessionId"]?.stringValue, !providerSessionId.isEmpty
        else { return nil }
        self.init(providerId: providerId, providerSessionId: providerSessionId)
    }
}

/// What opened a turn — `TURN_ORIGIN` in `@sidecar/wire`. The developer opens
/// a typed or spoken turn; every other origin is a wake, and the turn Luke's
/// own judgment.
public enum TurnOrigin: String, Sendable {
    case typed
    case spoken
    case rosterDiff = "roster_diff"
    case holdRelease = "hold_release"
    case child
    case childCompletion = "child_completion"
}

/// Where a turn stands — `TURN_STATUS` in `@sidecar/wire`.
public enum TurnStatus: String, Sendable {
    case queued
    case running
    case settled
    case cancelled
    case failed
}

/// Which conversation a turn group came from — `CONVERSATION_VIEW_SOURCE` in
/// `@sidecar/session`.
public enum ConversationViewSourceKind: String, Sendable {
    case main
    case observed
}

/// What a tool call is to the view — `CONVERSATION_VIEW_TOOL_KIND` in
/// `@sidecar/session`: an announcement or an action draws a row of its own,
/// and a detail draws only inside the expanded turn.
public enum ConversationViewToolKind: String, Sendable {
    case announce
    case action
    case detail
}

/// How an action stands as the view decided it —
/// `CONVERSATION_VIEW_ACTION_OUTCOME` in `@sidecar/session`. Refused and
/// unknown are opposite claims, one that nothing happened and one that
/// something may have, and the phone keeps them apart as the view does.
public enum ConversationActionOutcome: String, Sendable {
    case pending
    case accepted
    case unknown
    case refused
}

/// The facts recorded about a message beside it — `CONVERSATION_EVENT_KIND`
/// in `@sidecar/wire`.
public enum ConversationEventKind: String, Sendable {
    case speechOffered = "speech.offered"
    case speechClaimed = "speech.claimed"
    case speechSpoken = "speech.spoken"
    case speechPushed = "speech.pushed"
    case speechExpired = "speech.expired"
    case speechHeld = "speech.held"
    case rating

    /// Every kind but a rating is about how a briefing's delivery went.
    public var isSpeech: Bool { self != .rating }
}

/// The columns of a turn row a view reads — `ConversationViewTurn`.
public struct ConversationViewTurn: Equatable, Sendable {
    public let id: String
    public let origin: TurnOrigin
    public let status: TurnStatus
    public let queuedAt: Date
    public let startedAt: Date?
    public let settledAt: Date?

    init(
        id: String,
        origin: TurnOrigin,
        status: TurnStatus,
        queuedAt: Date,
        startedAt: Date? = nil,
        settledAt: Date? = nil
    ) {
        self.id = id
        self.origin = origin
        self.status = status
        self.queuedAt = queuedAt
        self.startedAt = startedAt
        self.settledAt = settledAt
    }
}

/// The conversation a group was selected from: the account's main, or an
/// observed session's — `ConversationViewSource`.
public enum ConversationViewSource: Equatable, Sendable {
    case main
    case observed(SessionIdentity)

    public var kind: ConversationViewSourceKind {
        switch self {
        case .main: .main
        case .observed: .observed
        }
    }
}

/// A tool call's identity as the view names it beside its decision.
public struct ToolPartIdentity: Equatable, Sendable {
    public let toolCallId: String
    public let toolName: String
    public let state: ToolPartState
}

/// One tool call of a shown message as the view decided it —
/// `ConversationViewToolPart`: its kind, and the one fact of each row kind
/// the part alone cannot say — whether an announcement went unspoken, how an
/// action stands.
public enum ConversationViewToolPart: Equatable, Sendable {
    case announce(ToolPartIdentity, unspoken: Bool)
    case action(ToolPartIdentity, outcome: ConversationActionOutcome)
    case detail(ToolPartIdentity)

    public var identity: ToolPartIdentity {
        switch self {
        case .announce(let identity, _), .action(let identity, _), .detail(let identity): identity
        }
    }

    public var kind: ConversationViewToolKind {
        switch self {
        case .announce: .announce
        case .action: .action
        case .detail: .detail
        }
    }
}

/// One message of a turn group — `ConversationReadMessage` in
/// `@sidecar/hosted`: the stored row, its place in its conversation's
/// sequence, when it was written, and its tool calls as the view decided them.
public struct ConversationReadMessage: Equatable, Sendable {
    public let message: UIMessage
    public let seq: Int
    public let createdAt: Date
    public let tools: [ConversationViewToolPart]
}

/// The messages one turn wrote that the view selected —
/// `ConversationReadTurnGroup`. A group may continue on a later page, and a
/// message still being written is answered on every read until it is
/// finished, so a device merges groups by turn id and keeps messages by
/// sequence, replacing the one it holds rather than keeping the first copy.
public struct ConversationReadTurnGroup: Equatable, Sendable {
    public let turnId: String
    public let conversationId: String
    public let source: ConversationViewSource
    public let turn: ConversationViewTurn?
    public let messages: [ConversationReadMessage]
}

/// One conversation the view is selected from, as the messages answer lists
/// them — `ConversationReadConversation`. A device drops the rows of a
/// conversation an answer no longer lists, which is how a Clear reaches a
/// screen that already drew the cleared rows.
public struct ConversationReadConversation: Equatable, Sendable {
    public let id: String
    public let source: ConversationViewSource
}

/// The messages endpoint's answer — `ConversationMessagesAnswer`. `next` is
/// the cursor the service minted, echoed back unchanged on the next read and
/// never composed here. A page may hold no group and still say more stands.
public struct ConversationMessagesAnswer: Equatable, Sendable {
    public let conversations: [ConversationReadConversation]
    public let groups: [ConversationReadTurnGroup]
    public let next: String
    public let hasMore: Bool
}

/// One event row about a message — `ConversationReadEvent`.
public struct ConversationReadEvent: Equatable, Sendable {
    public let id: String
    public let conversationId: String
    public let seq: Int
    public let messageId: String
    public let kind: ConversationEventKind
    public let deviceId: String?
    public let payload: JSONValue?
    public let createdAt: Date

    init(
        id: String,
        conversationId: String,
        seq: Int,
        messageId: String,
        kind: ConversationEventKind,
        deviceId: String? = nil,
        payload: JSONValue? = nil,
        createdAt: Date
    ) {
        self.id = id
        self.conversationId = conversationId
        self.seq = seq
        self.messageId = messageId
        self.kind = kind
        self.deviceId = deviceId
        self.payload = payload
        self.createdAt = createdAt
    }
}

/// The events endpoint's answer — `ConversationEventsAnswer`.
public struct ConversationEventsAnswer: Equatable, Sendable {
    public let events: [ConversationReadEvent]
    public let next: String
    public let hasMore: Bool
}

/// One turn as the turns endpoint answers it — `BrainTurnRecord`: the view's
/// columns, the conversation it ran over, how it ended, and its own cursor.
/// A turn is answered again each time a stamp on it moves, so a device
/// replaces the turn it holds by id.
public struct BrainTurnRecord: Equatable, Sendable {
    public let turn: ConversationViewTurn
    public let conversationId: String
    public let model: String?
    public let failure: String?
    public let cancelRequestedAt: Date?
    public let cursor: String

    init(
        turn: ConversationViewTurn,
        conversationId: String,
        model: String? = nil,
        failure: String? = nil,
        cancelRequestedAt: Date? = nil,
        cursor: String
    ) {
        self.turn = turn
        self.conversationId = conversationId
        self.model = model
        self.failure = failure
        self.cancelRequestedAt = cancelRequestedAt
        self.cursor = cursor
    }
}

/// The turns endpoint's answer — `BrainTurnsAnswer`; `next` is absent only
/// when nothing has ever been taken and nothing stood to take.
public struct BrainTurnsAnswer: Equatable, Sendable {
    public let turns: [BrainTurnRecord]
    public let next: String?
    public let hasMore: Bool
}

/// Where every resource's read stands now — `ChangesAnswer`: the cursor a
/// device reading each to its end would hold. A device compares each against
/// the cursor it holds and reads the resource whose head differs. `seen`
/// says whether the device row the request named is the account's; `false`
/// tells the device to register again, and the signal is answered either way.
public struct ChangesAnswer: Equatable, Sendable {
    public let seen: Bool
    public let messages: String
    public let events: String
    public let turns: String?
    public let rosterObservedAt: Date?

    init(seen: Bool, messages: String, events: String, turns: String? = nil, rosterObservedAt: Date? = nil) {
        self.seen = seen
        self.messages = messages
        self.events = events
        self.turns = turns
        self.rosterObservedAt = rosterObservedAt
    }
}

// MARK: - Decoding

extension KeyedDecodingContainer {
    /// An instant as the wire carries it: epoch milliseconds, whole and not negative.
    func decodeInstant(forKey key: Key) throws -> Date {
        let milliseconds = try decode(Double.self, forKey: key)
        guard milliseconds >= 0, milliseconds == milliseconds.rounded() else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: self, debugDescription: "not an epoch instant"
            )
        }
        return Date(timeIntervalSince1970: milliseconds / 1000)
    }

    func decodeInstantIfPresent(forKey key: Key) throws -> Date? {
        contains(key) ? try decodeInstant(forKey: key) : nil
    }

    func decodeRaw<Value: RawRepresentable>(
        _: Value.Type, forKey key: Key
    ) throws -> Value where Value.RawValue == String {
        let text = try decode(String.self, forKey: key)
        guard let value = Value(rawValue: text) else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: self, debugDescription: "\(Value.self) has no member \(text)"
            )
        }
        return value
    }

    /// A row's sequence: one or more.
    func decodeSequence(forKey key: Key) throws -> Int {
        let seq = try decode(Int.self, forKey: key)
        guard seq >= 1 else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: self, debugDescription: "a sequence starts at one"
            )
        }
        return seq
    }

    /// An identifier as written, refused only when empty.
    func decodeIdentifier(forKey key: Key) throws -> String {
        let text = try decode(String.self, forKey: key)
        guard !text.isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: self, debugDescription: "an empty identifier"
            )
        }
        return text
    }
}

extension ConversationViewTurn: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, origin, status, queuedAt, startedAt, settledAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try container.decodeIdentifier(forKey: .id),
            origin: try container.decodeRaw(TurnOrigin.self, forKey: .origin),
            status: try container.decodeRaw(TurnStatus.self, forKey: .status),
            queuedAt: try container.decodeInstant(forKey: .queuedAt),
            startedAt: try container.decodeInstantIfPresent(forKey: .startedAt),
            settledAt: try container.decodeInstantIfPresent(forKey: .settledAt)
        )
    }
}

extension ConversationViewSource: Decodable {
    private enum CodingKeys: String, CodingKey {
        case kind, session
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decodeRaw(ConversationViewSourceKind.self, forKey: .kind) {
        case .main:
            self = .main
        case .observed:
            self = .observed(try container.decode(SessionIdentity.self, forKey: .session))
        }
    }
}

extension ConversationViewToolPart: Decodable {
    private enum CodingKeys: String, CodingKey {
        case toolCallId, toolName, state, kind, unspoken, outcome
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let identity = ToolPartIdentity(
            toolCallId: try container.decodeIdentifier(forKey: .toolCallId),
            toolName: try container.decodeIdentifier(forKey: .toolName),
            state: try container.decodeRaw(ToolPartState.self, forKey: .state)
        )
        switch try container.decodeRaw(ConversationViewToolKind.self, forKey: .kind) {
        case .announce:
            self = .announce(identity, unspoken: try container.decode(Bool.self, forKey: .unspoken))
        case .action:
            self = .action(
                identity,
                outcome: try container.decodeRaw(ConversationActionOutcome.self, forKey: .outcome)
            )
        case .detail:
            self = .detail(identity)
        }
    }
}

extension ConversationReadMessage: Decodable {
    private enum CodingKeys: String, CodingKey {
        case message, seq, createdAt, tools
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            message: try container.decode(UIMessage.self, forKey: .message),
            seq: try container.decodeSequence(forKey: .seq),
            createdAt: try container.decodeInstant(forKey: .createdAt),
            tools: try container.decode([ConversationViewToolPart].self, forKey: .tools)
        )
    }
}

extension ConversationReadTurnGroup: Decodable {
    private enum CodingKeys: String, CodingKey {
        case turnId, conversationId, source, turn, messages
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let messages = try container.decode([ConversationReadMessage].self, forKey: .messages)
        guard !messages.isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .messages, in: container, debugDescription: "a group holds at least one row"
            )
        }
        self.init(
            turnId: try container.decodeIdentifier(forKey: .turnId),
            conversationId: try container.decodeIdentifier(forKey: .conversationId),
            source: try container.decode(ConversationViewSource.self, forKey: .source),
            turn: try container.decodeIfPresent(ConversationViewTurn.self, forKey: .turn),
            messages: messages
        )
    }
}

extension ConversationReadConversation: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, kind, session
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decodeIdentifier(forKey: .id)
        switch try container.decodeRaw(ConversationViewSourceKind.self, forKey: .kind) {
        case .main:
            self.init(id: id, source: .main)
        case .observed:
            self.init(
                id: id, source: .observed(try container.decode(SessionIdentity.self, forKey: .session))
            )
        }
    }
}

extension ConversationMessagesAnswer: Decodable {
    private enum CodingKeys: String, CodingKey {
        case conversations, groups, next, hasMore
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            conversations: try container.decode([ConversationReadConversation].self, forKey: .conversations),
            groups: try container.decode([ConversationReadTurnGroup].self, forKey: .groups),
            next: try container.decode(String.self, forKey: .next),
            hasMore: try container.decode(Bool.self, forKey: .hasMore)
        )
    }
}

extension ConversationReadEvent: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, conversationId, seq, messageId, kind, deviceId, payload, createdAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try container.decodeIdentifier(forKey: .id),
            conversationId: try container.decodeIdentifier(forKey: .conversationId),
            seq: try container.decodeSequence(forKey: .seq),
            messageId: try container.decodeIdentifier(forKey: .messageId),
            kind: try container.decodeRaw(ConversationEventKind.self, forKey: .kind),
            deviceId: try container.decodeIfPresent(String.self, forKey: .deviceId),
            payload: try container.decodeIfPresent(JSONValue.self, forKey: .payload),
            createdAt: try container.decodeInstant(forKey: .createdAt)
        )
    }
}

extension ConversationEventsAnswer: Decodable {
    private enum CodingKeys: String, CodingKey {
        case events, next, hasMore
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            events: try container.decode([ConversationReadEvent].self, forKey: .events),
            next: try container.decode(String.self, forKey: .next),
            hasMore: try container.decode(Bool.self, forKey: .hasMore)
        )
    }
}

extension BrainTurnRecord: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, conversationId, origin, status, model, queuedAt, startedAt, settledAt, failure
        case cancelRequestedAt, cursor
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            turn: ConversationViewTurn(
                id: try container.decodeIdentifier(forKey: .id),
                origin: try container.decodeRaw(TurnOrigin.self, forKey: .origin),
                status: try container.decodeRaw(TurnStatus.self, forKey: .status),
                queuedAt: try container.decodeInstant(forKey: .queuedAt),
                startedAt: try container.decodeInstantIfPresent(forKey: .startedAt),
                settledAt: try container.decodeInstantIfPresent(forKey: .settledAt)
            ),
            conversationId: try container.decodeIdentifier(forKey: .conversationId),
            model: try container.decodeIfPresent(String.self, forKey: .model),
            failure: try container.decodeIfPresent(String.self, forKey: .failure),
            cancelRequestedAt: try container.decodeInstantIfPresent(forKey: .cancelRequestedAt),
            cursor: try container.decodeIdentifier(forKey: .cursor)
        )
    }
}

extension BrainTurnsAnswer: Decodable {
    private enum CodingKeys: String, CodingKey {
        case turns, next, hasMore
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            turns: try container.decode([BrainTurnRecord].self, forKey: .turns),
            next: try container.decodeIfPresent(String.self, forKey: .next),
            hasMore: try container.decode(Bool.self, forKey: .hasMore)
        )
    }
}

extension ChangesAnswer: Decodable {
    private enum CodingKeys: String, CodingKey {
        case seen, messages, events, turns, rosterObservedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            seen: try container.decode(Bool.self, forKey: .seen),
            messages: try container.decode(String.self, forKey: .messages),
            events: try container.decode(String.self, forKey: .events),
            turns: try container.decodeIfPresent(String.self, forKey: .turns),
            rosterObservedAt: try container.decodeInstantIfPresent(forKey: .rosterObservedAt)
        )
    }
}
