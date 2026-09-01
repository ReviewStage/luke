import Foundation

/// One control a session's provider advertised for it, as the observe
/// endpoint reports it. Mirrors the `ObservedSessionControl` wire shape from
/// `@sidecar/hosted`: the id an act names, and the label and kind the row
/// draws. What the control targets never travels — the act endpoint
/// re-observes and rebuilds the write from its own fresh advertisement.
public struct RosterSessionControl: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    /// "stop" or "action", when the provider named one.
    public let kind: String?

    public init(id: String, label: String, kind: String? = nil) {
        self.id = id
        self.label = label
        self.kind = kind
    }

    init?(json: [String: Any]) {
        guard
            let id = json["id"] as? String, !id.isEmpty,
            let label = json["label"] as? String, !label.isEmpty
        else { return nil }
        self.id = id
        self.label = label
        self.kind = json["kind"] as? String
    }
}

/// One cloud session as reported by the observe endpoint.
/// Mirrors the `ObservedSession` wire shape from `@sidecar/hosted`.
public struct RosterSession: Identifiable, Sendable {
    public let providerId: String
    public let sessionId: String
    public let title: String
    public let status: String
    public let workspace: String?
    public let branch: String?
    public let recap: String?
    public let error: String?
    /// Unix milliseconds of the last observed activity, when the endpoint reported one.
    public let observedAt: Date?
    /// Whether the session's latest observation advertised taking a message.
    public let canReceiveMessage: Bool
    /// The controls the session's latest observation advertised.
    public let controls: [RosterSessionControl]
    /// Agent kinds the latest observation listed as spawnable in this session's workspace.
    public let spawnableAgents: [String]
    /// Whether the latest observation advertised renaming the session itself.
    public let canRename: Bool
    /// Whether the latest observation advertised renaming the session's workspace.
    public let canRenameWorkspace: Bool

    public var id: String { "\(providerId):\(sessionId)" }

    public init(
        providerId: String,
        sessionId: String,
        title: String,
        status: String,
        workspace: String? = nil,
        branch: String? = nil,
        recap: String? = nil,
        error: String? = nil,
        observedAt: Date? = nil,
        canReceiveMessage: Bool = false,
        controls: [RosterSessionControl] = [],
        spawnableAgents: [String] = [],
        canRename: Bool = false,
        canRenameWorkspace: Bool = false
    ) {
        self.providerId = providerId
        self.sessionId = sessionId
        self.title = title
        self.status = status
        self.workspace = workspace
        self.branch = branch
        self.recap = recap
        self.error = error
        self.observedAt = observedAt
        self.canReceiveMessage = canReceiveMessage
        self.controls = controls
        self.spawnableAgents = spawnableAgents
        self.canRename = canRename
        self.canRenameWorkspace = canRenameWorkspace
    }

    init?(json: [String: Any]) {
        guard
            let providerId = json["providerId"] as? String,
            let sessionId = json["sessionId"] as? String,
            let title = json["title"] as? String,
            let status = json["status"] as? String
        else { return nil }
        self.providerId = providerId
        self.sessionId = sessionId
        self.title = title
        self.status = status
        self.workspace = json["workspace"] as? String
        self.branch = json["branch"] as? String
        self.recap = json["recap"] as? String
        self.error = json["error"] as? String
        if let ms = json["observedAt"] as? Double {
            self.observedAt = Date(timeIntervalSince1970: ms / 1000)
        } else {
            self.observedAt = nil
        }
        self.canReceiveMessage = json["canReceiveMessage"] as? Bool ?? false
        let controlsJSON = json["controls"] as? [[String: Any]] ?? []
        self.controls = controlsJSON.compactMap { RosterSessionControl(json: $0) }
        let agents = json["spawnableAgents"] as? [String] ?? []
        self.spawnableAgents = agents.filter { !$0.isEmpty }
        self.canRename = json["canRename"] as? Bool ?? false
        self.canRenameWorkspace = json["canRenameWorkspace"] as? Bool ?? false
    }
}
