import Foundation

/// The kinds of action a Conversation row is drawn for: the session family
/// of `ACTION_KIND` in `@sidecar/actions`, whose tools answer in the output
/// envelope. An action of any other kind — an issue's, the app's own — draws
/// as a detail of its turn.
public enum ConversationActionKind: String, Sendable {
    case message
    case control
    case open
    case createWorkspace = "create-workspace"
    case addAgent = "add-agent"
    case renameWorkspace = "rename-workspace"
    case renameSession = "rename-session"
}

/// The tool names behind those kinds, as `ACTIONS` in `@sidecar/actions`
/// spells them for the model; the tool a part's type names is what says
/// which kind of row it is.
public enum ConversationActionTool: String, Sendable {
    case sendSessionMessage = "send_session_message"
    case runSessionControl = "run_session_control"
    case openSession = "open_session"
    case createWorkspace = "create_workspace"
    case addWorkspaceAgent = "add_workspace_agent"
    case renameWorkspace = "rename_workspace"
    case renameSession = "rename_session"

    public var kind: ConversationActionKind {
        switch self {
        case .sendSessionMessage: .message
        case .runSessionControl: .control
        case .openSession: .open
        case .createWorkspace: .createWorkspace
        case .addWorkspaceAgent: .addAgent
        case .renameWorkspace: .renameWorkspace
        case .renameSession: .renameSession
        }
    }
}

/// The session a row names, drawn as a chip: its current title while the
/// roster holds it, the title the envelope kept once it does not, under the
/// mark of the agent behind it or its provider. The chip is the row's own
/// press by another hand where the roster still holds the session, since a
/// session's screen on the phone stands on its roster row; every other chip
/// is a name.
public struct ConversationToolRowChip: Equatable, Sendable {
    public let text: String
    public let markId: String?
    public let identity: SessionIdentity?
    /// The roster row the chip opens, while the roster holds one.
    public let session: RosterSession?

    public init(text: String, markId: String? = nil, identity: SessionIdentity? = nil, session: RosterSession? = nil) {
        self.text = text
        self.markId = markId
        self.identity = identity
        self.session = session
    }

    public var openable: Bool { session != nil }
}

/// One run of a row's words: plain text, or the chip.
public enum ConversationToolRowRun: Equatable, Sendable {
    case text(String)
    case chip(ConversationToolRowChip)
}

/// An action's tool part as a row: composed from the call's own arguments
/// and the envelope its output carries, and nothing else, with the roster as
/// it stands supplying only the current name and screen of a session it
/// still holds. The words are the phone's own; the desktop words the same
/// parts itself, and what the two share is the set of things wordable — the
/// kinds, the outcomes, and the collapse rule — not the sentences.
public struct ConversationToolRow: Equatable, Sendable {
    public let kind: ConversationActionKind
    /// What a control does, when its adapter said.
    public let controlKind: RosterSessionControlKind?
    public let outcome: ConversationActionOutcome
    /// The provider the action reached, for the row's trailing mark.
    public let providerId: String?
    public let runs: [ConversationToolRowRun]
    /// Why a refused or unknown action ended as it did, or what an errored tool answered.
    public let reason: String?
    /// The carrier's own sentence about an accepted action, where it wrote one.
    public let note: String?
    public let warning: String?

    public init(
        kind: ConversationActionKind,
        controlKind: RosterSessionControlKind? = nil,
        outcome: ConversationActionOutcome,
        providerId: String? = nil,
        runs: [ConversationToolRowRun],
        reason: String? = nil,
        note: String? = nil,
        warning: String? = nil
    ) {
        self.kind = kind
        self.controlKind = controlKind
        self.outcome = outcome
        self.providerId = providerId
        self.runs = runs
        self.reason = reason
        self.note = note
        self.warning = warning
    }

    public var chip: ConversationToolRowChip? {
        for run in runs {
            if case .chip(let chip) = run { return chip }
        }
        return nil
    }

    /// The row's words with the chip's name in its place, for a reader that
    /// cannot press: accessibility, a test, a log line.
    public var sentence: String {
        runs.map { run in
            switch run {
            case .text(let text): text
            case .chip(let chip): chip.text
            }
        }.joined()
    }

    /// What a chip says of a session neither the roster nor the envelope can name.
    public static let unnamedSession = "an unnamed chat"
    /// What a row says when the record of the action's answer cannot be read.
    public static let unreadableEnvelope = "The record of this action's answer could not be read."

    /// The row an action's tool part draws, or nothing for a tool that is not
    /// a session action.
    public init?(part: ToolPart, roster: [RosterSession]) {
        guard let tool = ConversationActionTool(rawValue: part.toolName) else { return nil }
        let envelope: ActionOutputEnvelope? =
            part.state == .outputAvailable ? part.output.flatMap(ActionOutputEnvelope.init(json:)) : nil
        let target = envelope?.target
        let standing = Self.outcome(of: part, envelope: envelope)
        let composition = Self.compose(tool.kind, part: part, target: target, envelope: envelope, roster: roster)
        var note: String?
        var warning: String?
        if case .accepted(_, _, let acceptedNote, let acceptedWarning) = envelope {
            note = acceptedNote
            warning = acceptedWarning
        }
        self.init(
            kind: tool.kind,
            controlKind: composition.controlKind,
            outcome: standing.outcome,
            providerId: composition.providerId,
            runs: composition.runs,
            reason: standing.reason,
            note: note,
            warning: warning
        )
    }

    private struct Standing {
        let outcome: ConversationActionOutcome
        let reason: String?
    }

    /// What became of the action: pending until it settles, refused when
    /// its tool failed outright or its envelope says so, unknown where the
    /// envelope says the answer was lost — or where the envelope itself
    /// cannot be read, since a row that cannot say what happened must not
    /// say nothing happened — and accepted otherwise.
    private static func outcome(of part: ToolPart, envelope: ActionOutputEnvelope?) -> Standing {
        switch part.state {
        case .inputStreaming, .inputAvailable:
            return Standing(outcome: .pending, reason: nil)
        case .outputError:
            return Standing(outcome: .refused, reason: part.errorText)
        case .outputAvailable:
            guard let envelope else { return Standing(outcome: .unknown, reason: unreadableEnvelope) }
            switch envelope.status {
            case .accepted: return Standing(outcome: .accepted, reason: nil)
            case .unknown: return Standing(outcome: .unknown, reason: envelope.reason)
            case .refused: return Standing(outcome: .refused, reason: envelope.reason)
            }
        }
    }

    private struct Composition {
        let runs: [ConversationToolRowRun]
        let providerId: String?
        let controlKind: RosterSessionControlKind?
    }

    private enum Argument {
        static let providerId = "provider_id"
        static let providerSessionId = "provider_session_id"
        static let text = "text"
        static let application = "application"
        static let name = "name"
        static let agent = "agent"
    }

    private static func quoted(_ words: String) -> String { "“\(words)”" }

    private static func identity(in input: JSONValue?, target: ActionTargetSnapshot?) -> SessionIdentity? {
        if let providerId = input?[Argument.providerId]?.stringValue, !providerId.isEmpty,
           let sessionId = input?[Argument.providerSessionId]?.stringValue, !sessionId.isEmpty
        {
            return SessionIdentity(providerId: providerId, providerSessionId: sessionId)
        }
        guard let target, let sessionId = target.providerSessionId else { return nil }
        return SessionIdentity(providerId: target.providerId, providerSessionId: sessionId)
    }

    private static func rosterSession(_ identity: SessionIdentity?, in roster: [RosterSession]) -> RosterSession? {
        guard let identity else { return nil }
        return roster.first {
            $0.providerId == identity.providerId && $0.sessionId == identity.providerSessionId
        }
    }

    /// The chip for the session an action named: by the roster while it
    /// holds the session, by the envelope's snapshot once it does not, and by
    /// the call's own words where neither says.
    private static func chip(
        _ identity: SessionIdentity?,
        target: ActionTargetSnapshot?,
        roster: [RosterSession],
        fallbackName: String? = nil,
        fallbackMark: String? = nil
    ) -> ConversationToolRowChip {
        if let session = rosterSession(identity, in: roster) {
            return ConversationToolRowChip(
                text: session.title,
                markId: session.providerId,
                identity: SessionIdentity(providerId: session.providerId, providerSessionId: session.sessionId),
                session: session
            )
        }
        return ConversationToolRowChip(
            text: target?.title ?? fallbackName ?? unnamedSession,
            markId: target?.agentId ?? fallbackMark ?? target?.providerId ?? identity?.providerId,
            identity: identity
        )
    }

    private static func compose(
        _ kind: ConversationActionKind,
        part: ToolPart,
        target: ActionTargetSnapshot?,
        envelope: ActionOutputEnvelope?,
        roster: [RosterSession]
    ) -> Composition {
        let input = part.input
        let named = identity(in: input, target: target)
        let providerId = target?.providerId ?? named?.providerId
        switch kind {
        case .message:
            var runs: [ConversationToolRowRun] = [
                .text("Sent a message to "), .chip(chip(named, target: target, roster: roster)),
            ]
            if let text = input?[Argument.text]?.stringValue { runs.append(.text(": \(quoted(text))")) }
            return Composition(runs: runs, providerId: providerId, controlKind: nil)
        case .control:
            let controlKind = target?.controlKind
            let lead: String
            switch controlKind {
            case .archive: lead = "Archived "
            case .stop: lead = "Stopped "
            case .action, nil:
                lead = target?.controlLabel.map { "Ran \(quoted($0)) on " } ?? "Ran a control on "
            }
            return Composition(
                runs: [.text(lead), .chip(chip(named, target: target, roster: roster))],
                providerId: providerId,
                controlKind: controlKind
            )
        case .open:
            var runs: [ConversationToolRowRun] = [
                .text("Opened "), .chip(chip(named, target: target, roster: roster)),
            ]
            if let application = target?.applicationId ?? input?[Argument.application]?.stringValue {
                runs.append(.text(" in \(application)"))
            }
            return Composition(runs: runs, providerId: providerId, controlKind: nil)
        case .createWorkspace:
            var created: SessionIdentity?
            if case .accepted(_, let session, _, _) = envelope { created = session }
            let resolvedProvider = target?.providerId ?? input?[Argument.providerId]?.stringValue
            let name = input?[Argument.name]?.stringValue
            let mark = input?[Argument.agent]?.stringValue ?? resolvedProvider
            let chip: ConversationToolRowChip? =
                if let created {
                    chip(created, target: target, roster: roster, fallbackName: name, fallbackMark: mark)
                } else if let name {
                    ConversationToolRowChip(text: name, markId: mark)
                } else {
                    nil
                }
            let runs: [ConversationToolRowRun] =
                chip.map { [.text("Created a new workspace "), .chip($0)] } ?? [.text("Created a new workspace")]
            return Composition(runs: runs, providerId: resolvedProvider, controlKind: nil)
        case .addAgent:
            let lead = input?[Argument.agent]?.stringValue.map { "Added a \($0) agent to " } ?? "Added an agent to "
            return Composition(
                runs: [.text(lead), .chip(chip(named, target: target, roster: roster))],
                providerId: providerId,
                controlKind: nil
            )
        case .renameWorkspace, .renameSession:
            var runs: [ConversationToolRowRun] = [
                .text(kind == .renameWorkspace ? "Renamed workspace " : "Renamed "),
                .chip(chip(named, target: target, roster: roster)),
            ]
            if let name = input?[Argument.name]?.stringValue { runs.append(.text(" to \(quoted(name))")) }
            return Composition(runs: runs, providerId: providerId, controlKind: nil)
        }
    }
}
