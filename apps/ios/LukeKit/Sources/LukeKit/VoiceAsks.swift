import Foundation

/// The Realtime tools the phone's session may be handed, by the names
/// `REALTIME_TOOL` in `@sidecar/acts` gives them. A call naming anything
/// else is refused before it is looked at.
public enum VoiceToolName: String, Sendable, CaseIterable {
    case sendSessionMessage = "send_session_message"
    case runSessionControl = "run_session_control"
    case openSession = "open_session"
    case createWorkspace = "create_workspace"
    case addWorkspaceAgent = "add_workspace_agent"
    case renameWorkspace = "rename_workspace"
    case renameSession = "rename_session"
    case showPanel = "show_panel"
}

/// Why a tool call was refused, in words Luke can say aloud.
public struct VoiceAskRefusal: Error, Equatable, Sendable {
    public let reason: String

    public init(_ reason: String) { self.reason = reason }
}

/// A validated ask aimed at one provider's endpoint, so the act that lands
/// can be counted under that provider's name.
public protocol VoiceProviderAsk: Sendable {
    var providerId: String { get }
}

/// The phone's half of the act gauntlet, mirroring the `validate` rows of
/// `ACTS` in `@sidecar/acts` for the acts the phone carries: a call the model
/// composed may only name a session the roster showed, doing something that
/// session advertised, or a project the projects answer listed. Everything
/// else is refused with a reason. The hosted endpoints validate the same act
/// again on a fresh observation pass, so this is a first gate, never the last.
public enum VoiceAsks {
    /// The same bounds a typed message and a workspace name carry on the desktop.
    public static let maximumMessageLength = 4_000
    public static let maximumNameLength = 80

    // MARK: - Session acts

    public struct MessageAsk: Equatable, VoiceProviderAsk {
        public let session: RosterSession
        public let text: String

        public var providerId: String { session.providerId }
    }

    public struct ControlAsk: Equatable, VoiceProviderAsk {
        public let session: RosterSession
        public let control: RosterSessionControl

        public var providerId: String { session.providerId }
    }

    public struct AgentAsk: Equatable, VoiceProviderAsk {
        public let session: RosterSession
        public let agent: String
        public let name: String?
        public let task: String?
        /// The model as its wire id, and the effort riding it, when the developer named one.
        public let model: String?
        public let effort: String?

        public var providerId: String { session.providerId }
    }

    public struct RenameAsk: Equatable, VoiceProviderAsk {
        public let session: RosterSession
        public let name: String

        public var providerId: String { session.providerId }
    }

    /// The one session the call names, from the roster as it now stands.
    public static func session(
        _ arguments: [String: Any],
        in sessions: [RosterSession]
    ) -> Result<RosterSession, VoiceAskRefusal> {
        let providerId = text(arguments, "provider_id")
        let sessionId = text(arguments, "provider_session_id")
        guard
            let session = sessions.first(where: {
                $0.providerId == providerId && $0.sessionId == sessionId
            })
        else { return .failure(VoiceAskRefusal("No observed session matches that identity.")) }
        return .success(session)
    }

    public static func message(
        _ arguments: [String: Any],
        in sessions: [RosterSession]
    ) -> Result<MessageAsk, VoiceAskRefusal> {
        session(arguments, in: sessions).flatMap { session in
            guard session.canReceiveMessage else {
                return .failure(VoiceAskRefusal("That session does not take messages right now."))
            }
            guard let words = bounded(arguments["text"], maximumMessageLength) else {
                return .failure(VoiceAskRefusal("That message is empty or too long."))
            }
            return .success(MessageAsk(session: session, text: words))
        }
    }

    public static func control(
        _ arguments: [String: Any],
        in sessions: [RosterSession]
    ) -> Result<ControlAsk, VoiceAskRefusal> {
        session(arguments, in: sessions).flatMap { session in
            let controlId = text(arguments, "control_id")
            guard let control = session.controls.first(where: { $0.id == controlId }) else {
                return .failure(VoiceAskRefusal("That session advertises no such control."))
            }
            return .success(ControlAsk(session: session, control: control))
        }
    }

    /// An open on the phone lands on the session's own screen, so every
    /// observed session has somewhere to open.
    public static func open(
        _ arguments: [String: Any],
        in sessions: [RosterSession]
    ) -> Result<RosterSession, VoiceAskRefusal> {
        session(arguments, in: sessions)
    }

    public static func addAgent(
        _ arguments: [String: Any],
        in sessions: [RosterSession],
        agentModels: [WorkspaceAgentOption]
    ) -> Result<AgentAsk, VoiceAskRefusal> {
        session(arguments, in: sessions).flatMap { session in
            guard let agent = text(arguments, "agent"), session.spawnableAgents.contains(agent) else {
                return .failure(VoiceAskRefusal("That session lists no such agent to add."))
            }
            var name: String?
            if arguments["name"] != nil {
                guard let bound = bounded(arguments["name"], maximumNameLength) else {
                    return .failure(VoiceAskRefusal(nameBoundReason("A session name")))
                }
                name = bound
            }
            var task: String?
            if arguments["task"] != nil {
                guard let bound = bounded(arguments["task"], maximumMessageLength) else {
                    return .failure(VoiceAskRefusal("That task is empty or too long."))
                }
                task = bound
            }
            let spokenModel = text(arguments, "model")
            let spokenEffort = text(arguments, "effort")
            if spokenEffort != nil, spokenModel == nil {
                return .failure(VoiceAskRefusal("An effort rides a model; name the model too."))
            }
            var selection: AgentSelection?
            if let spokenModel {
                let entries = agentModels.filter {
                    $0.providerId == session.providerId && $0.agent == agent
                }
                switch resolveModel(entries, model: spokenModel, effort: spokenEffort) {
                case .success(let resolved): selection = resolved
                case .failure(let refusal):
                    return .failure(
                        refusal.reason == noSuchModelReason
                            ? VoiceAskRefusal("A \(agent) agent runs no model by that name.") : refusal
                    )
                }
            }
            return .success(
                AgentAsk(
                    session: session, agent: agent, name: name, task: task,
                    model: selection?.model, effort: selection?.effort
                )
            )
        }
    }

    public static func renameWorkspace(
        _ arguments: [String: Any],
        in sessions: [RosterSession]
    ) -> Result<RenameAsk, VoiceAskRefusal> {
        session(arguments, in: sessions).flatMap { session in
            guard session.canRenameWorkspace else {
                return .failure(VoiceAskRefusal("That session's workspace cannot be renamed."))
            }
            guard let name = bounded(arguments["name"], maximumNameLength) else {
                return .failure(VoiceAskRefusal(nameBoundReason("A workspace name")))
            }
            return .success(RenameAsk(session: session, name: name))
        }
    }

    public static func renameSession(
        _ arguments: [String: Any],
        in sessions: [RosterSession]
    ) -> Result<RenameAsk, VoiceAskRefusal> {
        session(arguments, in: sessions).flatMap { session in
            guard session.canRename else {
                return .failure(VoiceAskRefusal("That chat cannot be renamed."))
            }
            guard let name = bounded(arguments["name"], maximumNameLength) else {
                return .failure(VoiceAskRefusal(nameBoundReason("A chat name")))
            }
            return .success(RenameAsk(session: session, name: name))
        }
    }

    // MARK: - The list

    /// What a spoken list ask changes. A nil field is left as the developer
    /// had it; an empty filter set is the whole list.
    public struct SessionListAsk: Equatable, Sendable {
        public var filters: Set<SessionFilter>?
        public var sort: SessionSort?
        public var query: String?

        public init(filters: Set<SessionFilter>? = nil, sort: SessionSort? = nil, query: String? = nil) {
            self.filters = filters
            self.sort = sort
            self.query = query
        }
    }

    static let wholeList = "all"

    /// Validates a spoken narrowing against the sessions actually observed. A
    /// narrowing that would show nothing is refused rather than applied, and
    /// each value is checked on its own first so the refusal can name the
    /// value that is wrong rather than only the combination.
    public static func sessionList(
        _ arguments: [String: Any],
        in sessions: [RosterSession]
    ) -> Result<SessionListAsk, VoiceAskRefusal> {
        var ask = SessionListAsk()
        if let sortWord = arguments["sort"] {
            switch sortWord as? String {
            case "urgency": ask.sort = .urgency
            case "recency": ask.sort = .recency
            default: return .failure(VoiceAskRefusal("The list orders by urgency or by recency."))
            }
        }
        if let query = text(arguments, "query") {
            guard sessions.count >= 2 else {
                return .failure(
                    VoiceAskRefusal("The list offers a search only when more than one session is observed.")
                )
            }
            ask.query = query
        }
        guard let spoken = arguments["filters"] else { return .success(ask) }
        let entries: [String]
        if let one = spoken as? String {
            entries = [one]
        } else if let many = spoken as? [String] {
            entries = many
        } else {
            return .failure(VoiceAskRefusal("filters takes a list of filter values."))
        }
        var chosen: [String] = []
        for entry in entries {
            let value = entry.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty, !chosen.contains(value) { chosen.append(value) }
        }
        guard !chosen.isEmpty else { return .success(ask) }
        if chosen.contains(wholeList) {
            guard chosen.count == 1 else {
                return .failure(VoiceAskRefusal("\(wholeList) is the whole list, so it combines with nothing."))
            }
            ask.filters = []
            return .success(ask)
        }
        var filters = Set<SessionFilter>()
        for value in chosen {
            if sessions.contains(where: { $0.providerId == value }) {
                filters.insert(.provider(value))
            } else if sessions.contains(where: { $0.status == value }) {
                filters.insert(.status(value))
            } else if knownStatuses.contains(value) {
                return .failure(VoiceAskRefusal("No \(value) sessions are observed right now."))
            } else {
                return .failure(
                    VoiceAskRefusal("No observed session belongs to a provider \"\(value)\".")
                )
            }
        }
        if filters.count > 1, !sessions.contains(where: { matchesFilterSelection(filters, session: $0) }) {
            return .failure(VoiceAskRefusal("No observed session matches that combination of filters."))
        }
        ask.filters = filters
        return .success(ask)
    }

    /// The status words `SESSION_STATUS` fixes, so a status nobody is in right
    /// now is refused as absent rather than as unknown.
    static let knownStatuses: Set<String> = ["working", "waiting", "error", "complete", "unknown"]

    // MARK: - Creating a workspace

    public struct WorkspaceCreationAsk: Equatable, VoiceProviderAsk {
        public let project: RosterProject
        public let name: String?
        public let task: String?
        public let agent: String?
        public let model: String?
        public let effort: String?

        public var providerId: String { project.providerId }
    }

    /// Validates a creation ask against the projects the conversation was
    /// shown, settling only what the ask left unnamed from this device's own
    /// defaults: no provider named sends a still-ambiguous ask to the default
    /// provider while it is offering, and no project named sends it on to
    /// that provider's chosen project. Neither step can leave the listed set.
    public static func workspaceCreation(
        _ arguments: [String: Any],
        projects answer: ProjectsAnswer,
        defaultProviderId: String?,
        defaultProjectIds: [String: String]
    ) -> Result<WorkspaceCreationAsk, VoiceAskRefusal> {
        let providerId = text(arguments, "provider_id")
        let projectId = text(arguments, "project_id")
        var matching = answer.projects.filter {
            (providerId == nil || $0.providerId == providerId)
                && (projectId == nil || $0.providerProjectId == projectId)
        }
        if providerId == nil, let defaultProviderId, matching.count > 1 {
            let offeredByDefault = matching.filter { $0.providerId == defaultProviderId }
            if !offeredByDefault.isEmpty { matching = offeredByDefault }
        }
        if projectId == nil, matching.count > 1, let first = matching.first,
            matching.allSatisfy({ $0.providerId == first.providerId })
        {
            let chosen = matching.filter {
                defaultProjectIds[$0.providerId] == $0.providerProjectId
            }
            if chosen.count == 1 { matching = chosen }
        }
        guard matching.count == 1, let project = matching.first else {
            return .failure(
                VoiceAskRefusal(
                    matching.isEmpty
                        ? "No listed project matches that identity."
                        : "More than one listed project matches; name the project."
                )
            )
        }

        let options = answer.agentModels.filter { $0.providerId == project.providerId }
        var agent: String?
        if let requested = text(arguments, "agent") {
            let named = options.filter { $0.agent.lowercased() == requested.lowercased() }
            guard let option = named.first(where: { $0.agent == requested }) ?? (named.count == 1 ? named[0] : nil)
            else { return .failure(VoiceAskRefusal("That project lists no such agent to start.")) }
            agent = option.agent
        }

        var name: String?
        if arguments["name"] != nil {
            if project.namesItself {
                return .failure(VoiceAskRefusal("That project names its own workspaces."))
            }
            guard let bound = bounded(arguments["name"], maximumNameLength) else {
                return .failure(VoiceAskRefusal(nameBoundReason("A workspace name")))
            }
            name = bound
        }

        var task: String?
        if arguments["task"] != nil {
            if project.taskSupport == ProjectTaskSupport.none {
                return .failure(VoiceAskRefusal("That project takes no opening task."))
            }
            guard let bound = bounded(arguments["task"], maximumMessageLength) else {
                return .failure(VoiceAskRefusal("That task is empty or too long."))
            }
            task = bound
        } else if project.taskSupport == .required {
            return .failure(VoiceAskRefusal("That project needs an opening task to create a workspace."))
        }

        let spokenModel = text(arguments, "model")
        let spokenEffort = text(arguments, "effort")
        if spokenEffort != nil, spokenModel == nil {
            return .failure(VoiceAskRefusal("An effort rides a model; name the model too."))
        }
        var selection: AgentSelection?
        if let spokenModel {
            // A model named beside an agent resolves within that agent alone;
            // named alone, it resolves across the provider's table and the
            // agent that runs it is the one started.
            let entries = agent.map { kind in options.filter { $0.agent == kind } } ?? options
            switch resolveModel(entries, model: spokenModel, effort: spokenEffort) {
            case .success(let resolved): selection = resolved
            case .failure(let refusal): return .failure(refusal)
            }
        } else if let agent, let option = options.first(where: { $0.agent == agent }),
            let first = option.models.first
        {
            // The creation endpoint takes an agent only beside a model, so an
            // agent named alone runs the first model its table lists — the
            // same one the New Workspace sheet preselects for it.
            selection = AgentSelection(agent: agent, model: first.id, effort: nil)
        }

        return .success(
            WorkspaceCreationAsk(
                project: project,
                name: name,
                task: task,
                agent: selection?.agent ?? agent,
                model: selection?.model,
                effort: selection?.effort
            )
        )
    }

    // MARK: - Shared

    struct AgentSelection: Equatable {
        let agent: String
        let model: String
        let effort: String?
    }

    static let noSuchModelReason = "No documented model goes by that name here."

    /// Resolves a model the developer named — by the label the table lists it
    /// under, or its id — to the wire pairing the endpoint takes. The effort,
    /// when named, must be one the resolved model's own agent documents.
    static func resolveModel(
        _ entries: [WorkspaceAgentOption],
        model word: String,
        effort effortWord: String?
    ) -> Result<AgentSelection, VoiceAskRefusal> {
        let normalized = word.lowercased()
        let named = entries.lazy
            .flatMap { entry in entry.models.map { (entry: entry, model: $0) } }
            .first { $0.model.label.lowercased() == normalized || $0.model.id.lowercased() == normalized }
        guard let named else { return .failure(VoiceAskRefusal(noSuchModelReason)) }
        var effort: String?
        if let effortWord {
            let normalizedEffort = effortWord.lowercased()
            guard let level = named.entry.efforts.first(where: { $0.lowercased() == normalizedEffort })
            else {
                return .failure(
                    VoiceAskRefusal(
                        named.entry.efforts.isEmpty
                            ? "That model takes no effort level."
                            : "That model's effort is one of \(named.entry.efforts.joined(separator: ", "))."
                    )
                )
            }
            effort = level
        }
        return .success(AgentSelection(agent: named.entry.agent, model: named.model.id, effort: effort))
    }

    static func nameBoundReason(_ subject: String) -> String {
        "\(subject) has to be under \(maximumNameLength) characters and longer than nothing."
    }

    /// A string argument trimmed to its words, or nothing when absent or blank.
    static func text(_ arguments: [String: Any], _ key: String) -> String? {
        guard let value = arguments[key] as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Text refused rather than cut when it runs long: a truncated message or
    /// name says something its author did not.
    static func bounded(_ value: Any?, _ maximumLength: Int) -> String? {
        guard let value = value as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= maximumLength else { return nil }
        return trimmed
    }
}
