import Foundation

/// Whose judgment a turn's rows record. A turn the developer opened — typed
/// or spoken — is an ask, and everything Luke said and did in it answers it;
/// a turn nobody opened — a roster diff, a hold's release, a child's end — is
/// Luke's own, and every row of it says so, so what he decided for himself is
/// never read as something the developer asked. A turn with no row to say
/// who opened it is drawn as an ask rather than claimed as Luke's own.
public enum ConversationJudgment: String, Sendable {
    case ask
    case own
}

/// Who a row of words speaks for.
public enum ConversationSpeaker: Sendable {
    /// The developer's own ask, typed or spoken.
    case you
    /// Luke's reply, or his briefing.
    case luke
    /// A note the brain wrote itself into the conversation, never the developer's words.
    case note
    /// Luke's own words in a turn nobody opened.
    case own
}

/// One stored tool call of an assistant message as the thread draws it
/// inside that message's fold: a session action keeps the richer action row,
/// and every other tool call keeps the quieter tool-name-and-state row.
public enum ConversationToolCall: Equatable, Sendable, Identifiable {
    case action(toolCallId: String, row: ConversationToolRow)
    case detail(ToolPart)

    public var id: String {
        switch self {
        case .action(let toolCallId, _): toolCallId
        case .detail(let part): part.toolCallId
        }
    }
}

/// One of Luke's messages as a rating names it: the row the service takes a
/// verdict on, the conversation it stands in, and which kind of message it
/// is to the count. Only an assistant message is one — a message Luke said
/// to the developer, a reply or a briefing — which is exactly the set the
/// service accepts a rating for; the developer's own ask and the brain's note
/// to itself carry none, so no control is drawn where the service would
/// refuse it. A compaction summary is Luke's too but never enters the view.
public struct RateableMessage: Equatable, Sendable {
    public let messageId: String
    public let conversationId: String
    public let kind: ProductRatedMessageKind
}

/// One row of a turn as the screen draws it.
public enum ConversationRow: Equatable, Sendable, Identifiable {
    /// A text part, or an announcement's words; `unspoken` marks a briefing
    /// nobody heard, and `rateable` names the message a thumb would rate on
    /// the message's last words, so one message takes one control.
    case words(
        id: String,
        speaker: ConversationSpeaker,
        text: String,
        at: Date,
        unspoken: Bool,
        rateable: RateableMessage?
    )
    /// Luke's thought before what followed it, folded to a line that opens on its words.
    case reasoning(id: String, text: String)
    /// Every stored tool call of one assistant message, under one line that
    /// counts them and dated by that message.
    case toolCallsFold(id: String, rows: [ConversationToolCall], at: Date)

    public var id: String {
        switch self {
        case .words(let id, _, _, _, _, _), .reasoning(let id, _), .toolCallsFold(let id, _, _):
            id
        }
    }

    /// The instant a row is dated by. A thought and the turn's working carry
    /// none: they stand under the rows around them rather than at a moment of
    /// their own.
    public var instant: Date? {
        switch self {
        case .words(_, _, _, let at, _, _), .toolCallsFold(_, _, let at): at
        case .reasoning: nil
        }
    }
}

/// The reader's press on a tool-call fold, remembered with the turn state it
/// was made under. The fold follows the turn — open while the turn still
/// runs, closed once it has settled — unless the reader pressed it under that
/// same state, in which case their press holds; a press made while the turn
/// ran does not outlive the turn's settling, since the turn's own change is
/// the later word.
public struct ConversationFoldChoice: Equatable, Sendable {
    public let pending: Bool
    public let open: Bool

    public init(pending: Bool, open: Bool) {
        self.pending = pending
        self.open = open
    }
}

/// One turn group as rows: each message's parts in order, drawn as what they
/// are, and every assistant message that carried tool calls opening with one
/// fold of them ahead of the words they produced. Which tool calls are
/// announcements, actions, or details is the view's decision, read back by
/// call id; a call the view did not describe still joins that fold. Pure
/// over the group and the roster, so the screen only draws.
public struct ConversationTurnRows: Equatable, Sendable, Identifiable {
    public let turnId: String
    public let judgment: ConversationJudgment
    /// Whether the turn is still going: queued for its run, or running it.
    public let pending: Bool
    public let rows: [ConversationRow]

    public var id: String { turnId }

    /// When the turn's first dated row stands, for the time break a screen
    /// may set over it; nil for a turn of thoughts and working alone.
    public var opensAt: Date? { rows.compactMap(\.instant).first }

    /// When the turn's last dated row stands, for the silence the next turn's
    /// break is measured from.
    public var closesAt: Date? { rows.compactMap(\.instant).last }

    /// The origins the developer opened a turn by; every other origin is a wake, and the turn Luke's own.
    private static let developerOrigins: Set<TurnOrigin> = [.typed, .spoken]
    private static let pendingStatuses: Set<TurnStatus> = [.queued, .running]
    /// The one argument an announce call carries.
    private static let briefingArgument = "briefing"

    public static func judgment(of turn: ConversationViewTurn?) -> ConversationJudgment {
        guard let turn, !developerOrigins.contains(turn.origin) else { return .ask }
        return .own
    }

    public static func pending(_ turn: ConversationViewTurn?) -> Bool {
        guard let turn else { return false }
        return pendingStatuses.contains(turn.status)
    }

    /// Whether a tool-call fold stands open, as the turn's state has it
    /// unless the reader's press under that same state says otherwise.
    public static func foldOpen(choice: ConversationFoldChoice?, pending: Bool) -> Bool {
        guard let choice, choice.pending == pending else { return pending }
        return choice.open
    }

    /// The row a screen asked to open at one message — a push's tap — scrolls
    /// to: the message's own row where it drew one, or the first of its parts'
    /// rows, whose id is the message's with a suffix behind a colon
    /// (a message id is a UUID and holds none). Nil where the message drew no
    /// row of its own, or stands in none of these turns at all.
    public static func anchor(forMessage messageId: String, in turns: [ConversationTurnRows]) -> String? {
        let partPrefix = "\(messageId):"
        for turn in turns {
            if let row = turn.rows.first(where: { $0.id == messageId || $0.id.hasPrefix(partPrefix) }) {
                return row.id
            }
        }
        return nil
    }

    public init(group: ConversationReadTurnGroup, roster: [RosterSession]) {
        turnId = group.turnId
        judgment = Self.judgment(of: group.turn)
        pending = Self.pending(group.turn)
        var rows: [ConversationRow] = []
        for message in group.messages {
            rows.append(
                contentsOf: Self.draw(
                    message, conversationId: group.conversationId, judgment: judgment, roster: roster
                )
            )
        }
        self.rows = rows
    }

    private static func draw(
        _ view: ConversationReadMessage,
        conversationId: String,
        judgment: ConversationJudgment,
        roster: [RosterSession]
    ) -> [ConversationRow] {
        let message = view.message
        switch message.attribution {
        case .system:
            return []
        case .user(let metadata):
            let text = message.parts.compactMap { part -> String? in
                if case .text(let text) = part { return text }
                return nil
            }.joined(separator: "\n\n")
            let speaker: ConversationSpeaker = metadata.author == .developer ? .you : .note
            return [
                .words(id: message.id, speaker: speaker, text: text, at: view.createdAt, unspoken: false, rateable: nil),
            ]
        case .assistant:
            let described = Dictionary(
                view.tools.map { ($0.identity.toolCallId, $0) }, uniquingKeysWith: { first, _ in first }
            )
            let rateable = RateableMessage(
                messageId: message.id,
                conversationId: conversationId,
                kind: view.tools.contains { $0.kind == .announce } ? .announcement : .reply
            )
            var rows: [ConversationRow] = []
            var toolCalls: [ConversationToolCall] = []
            var lastWordsIndex: Int?
            for (index, part) in message.parts.enumerated() {
                let id = "\(message.id):\(index)"
                switch part {
                case .text(let text):
                    let speaker: ConversationSpeaker = judgment == .own ? .own : .luke
                    rows.append(
                        .words(id: id, speaker: speaker, text: text, at: view.createdAt, unspoken: false, rateable: nil)
                    )
                    lastWordsIndex = rows.count - 1
                case .reasoning(let text):
                    rows.append(.reasoning(id: id, text: text))
                case .stepStart, .other:
                    continue
                case .tool(let tool):
                    if let row = ConversationToolRow(part: tool, roster: roster) {
                        toolCalls.append(.action(toolCallId: tool.toolCallId, row: row))
                    } else {
                        toolCalls.append(.detail(tool))
                    }
                    switch described[tool.toolCallId] {
                    case .announce(_, let unspoken):
                        guard let words = tool.input?[briefingArgument]?.stringValue else { continue }
                        rows.append(
                            .words(id: id, speaker: .luke, text: words, at: view.createdAt, unspoken: unspoken, rateable: nil)
                        )
                        lastWordsIndex = rows.count - 1
                    case .action, .detail, nil:
                        continue
                    }
                }
            }
            if let lastWordsIndex,
               case .words(let id, let speaker, let text, let at, let unspoken, _) = rows[lastWordsIndex]
            {
                rows[lastWordsIndex] =
                    .words(id: id, speaker: speaker, text: text, at: at, unspoken: unspoken, rateable: rateable)
            }
            if toolCalls.isEmpty { return rows }
            let fold = ConversationRow.toolCallsFold(
                id: "\(message.id):tools", rows: toolCalls, at: view.createdAt
            )
            let insertAt = rows.firstIndex { row in
                if case .words = row { return true }
                return false
            } ?? rows.endIndex
            var ordered = rows
            ordered.insert(fold, at: insertAt)
            return ordered
        }
    }
}
