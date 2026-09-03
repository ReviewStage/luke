import Foundation

/// What a control does, as its adapter declared it. Mirrors
/// `SESSION_CONTROL_KIND` in `@sidecar/session`: the adapter says which its
/// control is, because only it knows what the endpoint behind the control
/// means — a surface keying on the id or the label instead would be reading
/// the provider's own words as a contract they never made.
public enum RosterSessionControlKind: String, Sendable {
    case action
    case archive
    case stop
}

/// One control a session's provider advertised for it, as the observe
/// endpoint reports it. Mirrors the `ObservedSessionControl` wire shape from
/// `@sidecar/hosted`: the id an act names, and the label and kind the row
/// draws. What the control targets never travels — the act endpoint
/// re-observes and rebuilds the write from its own fresh advertisement.
public struct RosterSessionControl: Identifiable, Hashable, Sendable {
    public let id: String
    public let label: String
    /// nil when the provider named none, or one this build does not know:
    /// the control still works, drawn as a plain action by its label.
    public let kind: RosterSessionControlKind?

    public init(id: String, label: String, kind: RosterSessionControlKind? = nil) {
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
        self.kind = (json["kind"] as? String).flatMap { RosterSessionControlKind(rawValue: $0) }
    }
}

/// One cloud session as reported by the observe endpoint.
/// Mirrors the `ObservedSession` wire shape from `@sidecar/hosted`.
public struct RosterSession: Identifiable, Hashable, Sendable {
    public let providerId: String
    public let sessionId: String
    public let title: String
    public let status: String
    public let workspace: String?
    public let branch: String?
    /// HTTPS address of the work this session published, when it reported one.
    public let change: URL?
    /// Provider-owned address that opens this session where it lives, when
    /// the provider reported one — a deep link into the provider's own app.
    public let link: URL?
    public let recap: String?
    public let error: String?
    /// When the provider last wrote anything about the session, when the endpoint reported it.
    public let lastActivityAt: Date?
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
    /// Whether the hosted messages endpoint can read this session's
    /// conversation — a capability of the provider's documented transcript
    /// read, so a screen that sees it absent falls back to the recap alone.
    public let canReadConversation: Bool

    public var id: String { "\(providerId):\(sessionId)" }

    /// The recap as the one line a row can spare: its line breaks and runs of
    /// space closed to single spaces. The recap itself keeps the lines it was
    /// written in, because the session screen draws them as Markdown.
    public var recapLine: String? {
        recap.map { $0.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
    }

    public init(
        providerId: String,
        sessionId: String,
        title: String,
        status: String,
        workspace: String? = nil,
        branch: String? = nil,
        change: URL? = nil,
        link: URL? = nil,
        recap: String? = nil,
        error: String? = nil,
        lastActivityAt: Date? = nil,
        canReceiveMessage: Bool = false,
        controls: [RosterSessionControl] = [],
        spawnableAgents: [String] = [],
        canRename: Bool = false,
        canRenameWorkspace: Bool = false,
        canReadConversation: Bool = false
    ) {
        self.providerId = providerId
        self.sessionId = sessionId
        self.title = title
        self.status = status
        self.workspace = workspace
        self.branch = branch
        self.change = change
        self.link = link
        self.recap = recap
        self.error = error
        self.lastActivityAt = lastActivityAt
        self.canReceiveMessage = canReceiveMessage
        self.controls = controls
        self.spawnableAgents = spawnableAgents
        self.canRename = canRename
        self.canRenameWorkspace = canRenameWorkspace
        self.canReadConversation = canReadConversation
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
        self.change = Self.httpsURL(json["change"])
        self.link = Self.openableURL(json["link"])
        self.recap = json["recap"] as? String
        self.error = json["error"] as? String
        // `observedAt` is the name this field traveled under before the rename;
        // a service still sending only that name dates the session the same way.
        if let ms = (json["lastActivityAt"] ?? json["observedAt"]) as? Double {
            self.lastActivityAt = Date(timeIntervalSince1970: ms / 1000)
        } else {
            self.lastActivityAt = nil
        }
        self.canReceiveMessage = json["canReceiveMessage"] as? Bool ?? false
        let controlsJSON = json["controls"] as? [[String: Any]] ?? []
        self.controls = controlsJSON.compactMap { RosterSessionControl(json: $0) }
        let agents = json["spawnableAgents"] as? [String] ?? []
        self.spawnableAgents = agents.filter { !$0.isEmpty }
        self.canRename = json["canRename"] as? Bool ?? false
        self.canRenameWorkspace = json["canRenameWorkspace"] as? Bool ?? false
        self.canReadConversation = json["canReadConversation"] as? Bool ?? false
    }

    private static func httpsURL(_ value: Any?) -> URL? {
        guard
            let value = value as? String,
            let url = URL(string: value),
            url.scheme == "https",
            url.host?.isEmpty == false
        else { return nil }
        return url
    }

    /// The schemes a session address may be handed to the operating system
    /// with. Mirrors `SESSION_LINK_SCHEME` in `@sidecar/session`: the link is
    /// the one observed field this app acts on rather than draws, so the set
    /// is fixed by the build and applied here, where the wire is parsed — an
    /// address outside it never becomes a button at all.
    private static let openableLinkSchemes: Set<String> = [
        "https", "codex", "conductor", "superset",
    ]

    private static func openableURL(_ value: Any?) -> URL? {
        guard
            let value = value as? String,
            let url = URL(string: value),
            let scheme = url.scheme?.lowercased(),
            Self.openableLinkSchemes.contains(scheme)
        else { return nil }
        return url
    }
}
