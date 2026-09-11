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

/// What a turn folds a level down: a call the view classed as a detail — a
/// read, a workspace write, a delegation — named by its tool and state and
/// nothing of what it read or wrote, and an action that was refused, drawn
/// inside the turn that tried it and never as a row of its own.
public enum ConversationDetail: Equatable, Sendable, Identifiable {
    case tool(ToolPart)
    case refusedAction(toolCallId: String, row: ConversationToolRow)

    public var id: String {
        switch self {
        case .tool(let part): part.toolCallId
        case .refusedAction(let toolCallId, _): toolCallId
        }
    }
}

/// One row of a turn as the screen draws it.
public enum ConversationRow: Equatable, Sendable, Identifiable {
    /// A text part, or an announcement's words; `unspoken` marks a briefing nobody heard.
    case words(id: String, speaker: ConversationSpeaker, text: String, at: Date, unspoken: Bool)
    /// Luke's thought before what followed it, folded to a line that opens on its words.
    case reasoning(id: String, text: String)
    /// One action, standing as a row of its own.
    case action(id: String, row: ConversationToolRow, at: Date)
    /// Every action of a turn that carried several, under one line that counts them.
    case actionsFold(id: String, rows: [ConversationToolRow], at: Date)
    /// The turn's working, under a count: closed by default.
    case details(id: String, items: [ConversationDetail])

    public var id: String {
        switch self {
        case .words(let id, _, _, _, _), .reasoning(let id, _), .action(let id, _, _),
             .actionsFold(let id, _, _), .details(let id, _):
            id
        }
    }
}

/// The reader's press on an actions fold, remembered with the turn state it
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
/// are, the turn's actions folded under a count once there are two, and its
/// working — details and refused actions — closing the turn under one fold.
/// Which tool calls are announcements, actions, or details is the view's
/// decision, read back by call id; a call the view did not describe is a
/// detail. Pure over the group and the roster, so the screen only draws.
public struct ConversationTurnRows: Equatable, Sendable, Identifiable {
    public let turnId: String
    public let judgment: ConversationJudgment
    /// Whether the turn is still going: queued for its run, or running it.
    public let pending: Bool
    public let rows: [ConversationRow]

    public var id: String { turnId }

    /// How many actions a turn carries before they fold under a count rather than standing as rows.
    public static let foldFromActions = 2

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

    /// Whether an actions fold stands open, as the turn's state has it unless
    /// the reader's press under that same state says otherwise.
    public static func foldOpen(choice: ConversationFoldChoice?, pending: Bool) -> Bool {
        guard let choice, choice.pending == pending else { return pending }
        return choice.open
    }

    public init(group: ConversationReadTurnGroup, roster: [RosterSession]) {
        turnId = group.turnId
        judgment = Self.judgment(of: group.turn)
        pending = Self.pending(group.turn)
        var drawn: [Drawn] = []
        var details: [ConversationDetail] = []
        for message in group.messages {
            Self.draw(message, judgment: judgment, roster: roster, into: &drawn, details: &details)
        }
        var rows = Self.placeActions(drawn, turnId: group.turnId)
        if !details.isEmpty { rows.append(.details(id: "\(group.turnId):details", items: details)) }
        self.rows = rows
    }

    /// A row as a message hands it to its turn: drawn already, or an action
    /// the turn decides the place of.
    private enum Drawn {
        case row(ConversationRow)
        case action(id: String, row: ConversationToolRow, at: Date)
    }

    private static func draw(
        _ view: ConversationReadMessage,
        judgment: ConversationJudgment,
        roster: [RosterSession],
        into drawn: inout [Drawn],
        details: inout [ConversationDetail]
    ) {
        let message = view.message
        switch message.attribution {
        case .system:
            return
        case .user(let metadata):
            let text = message.parts.compactMap { part -> String? in
                if case .text(let text) = part { return text }
                return nil
            }.joined(separator: "\n\n")
            let speaker: ConversationSpeaker = metadata.author == .developer ? .you : .note
            drawn.append(.row(.words(id: message.id, speaker: speaker, text: text, at: view.createdAt, unspoken: false)))
        case .assistant:
            let described = Dictionary(
                view.tools.map { ($0.identity.toolCallId, $0) }, uniquingKeysWith: { first, _ in first }
            )
            for (index, part) in message.parts.enumerated() {
                let id = "\(message.id):\(index)"
                switch part {
                case .text(let text):
                    let speaker: ConversationSpeaker = judgment == .own ? .own : .luke
                    drawn.append(.row(.words(id: id, speaker: speaker, text: text, at: view.createdAt, unspoken: false)))
                case .reasoning(let text):
                    drawn.append(.row(.reasoning(id: id, text: text)))
                case .stepStart, .other:
                    continue
                case .tool(let tool):
                    switch described[tool.toolCallId] {
                    case .announce(_, let unspoken):
                        guard let words = tool.input?[briefingArgument]?.stringValue else { continue }
                        drawn.append(.row(.words(id: id, speaker: .luke, text: words, at: view.createdAt, unspoken: unspoken)))
                    case .action(_, let outcome):
                        guard let row = ConversationToolRow(part: tool, roster: roster) else {
                            details.append(.tool(tool))
                            continue
                        }
                        if outcome == .refused {
                            details.append(.refusedAction(toolCallId: tool.toolCallId, row: row))
                        } else {
                            drawn.append(.action(id: id, row: row, at: view.createdAt))
                        }
                    case .detail, nil:
                        details.append(.tool(tool))
                    }
                }
            }
        }
    }

    /// The turn's rows in order, its actions placed: each a stamped row of its
    /// own while there are too few to fold, or all of them inside one fold
    /// standing where the first stood.
    private static func placeActions(_ drawn: [Drawn], turnId: String) -> [ConversationRow] {
        let actions = drawn.compactMap { entry -> (id: String, row: ConversationToolRow, at: Date)? in
            if case .action(let id, let row, let at) = entry { return (id, row, at) }
            return nil
        }
        guard let first = actions.first, actions.count >= foldFromActions else {
            return drawn.map { entry in
                switch entry {
                case .row(let row): row
                case .action(let id, let row, let at): .action(id: id, row: row, at: at)
                }
            }
        }
        return drawn.compactMap { entry in
            switch entry {
            case .row(let row):
                return row
            case .action(let id, _, _):
                guard id == first.id else { return nil }
                return .actionsFold(id: "\(turnId):actions", rows: actions.map(\.row), at: first.at)
            }
        }
    }
}
