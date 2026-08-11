public enum AgentProvider: String, Codable, CaseIterable, Sendable {
    case claudeCode = "Claude Code"
    case codex = "Codex"
}

public enum SessionStatus: String, Codable, CaseIterable, Sendable {
    case working
    case waitingForUser
    case completed

    public var displayName: String {
        switch self {
        case .working:
            "Working"
        case .waitingForUser:
            "Needs attention"
        case .completed:
            "Complete"
        }
    }

    public var requiresAttention: Bool {
        self == .waitingForUser
    }
}

public struct DemoSession: Identifiable, Codable, Equatable, Sendable {
    public let id: String
    public let provider: AgentProvider
    public let title: String
    public let repository: String
    public let status: SessionStatus
    public let detail: String

    public init(
        id: String,
        provider: AgentProvider,
        title: String,
        repository: String,
        status: SessionStatus,
        detail: String
    ) {
        self.id = id
        self.provider = provider
        self.title = title
        self.repository = repository
        self.status = status
        self.detail = detail
    }
}

public struct SessionDigest: Equatable, Sendable {
    public let totalCount: Int
    public let activeCount: Int
    public let attentionCount: Int

    public var headline: String {
        if attentionCount == 1 {
            return "1 session needs attention"
        }

        if attentionCount > 1 {
            return "\(attentionCount) sessions need attention"
        }

        return activeCount == 0 ? "All sessions are quiet" : "Sessions are progressing"
    }
}

public struct DemoSnapshot: Codable, Equatable, Sendable {
    public let fixtureVersion: Int
    public let sessions: [DemoSession]

    public init(fixtureVersion: Int, sessions: [DemoSession]) {
        self.fixtureVersion = fixtureVersion
        self.sessions = sessions
    }

    public var digest: SessionDigest {
        SessionDigest(
            totalCount: sessions.count,
            activeCount: sessions.filter { $0.status == .working }.count,
            attentionCount: sessions.filter { $0.status.requiresAttention }.count
        )
    }

    public static let development = DemoSnapshot(
        fixtureVersion: 1,
        sessions: [
            DemoSession(
                id: "codex-bootstrap",
                provider: .codex,
                title: "Bootstrap the macOS shell",
                repository: "sidecar-shell",
                status: .working,
                detail: "Building the deterministic app fixture"
            ),
            DemoSession(
                id: "claude-trust-review",
                provider: .claudeCode,
                title: "Review trust constraints",
                repository: "sidecar-safety",
                status: .waitingForUser,
                detail: "One implementation decision is ready for review"
            ),
            DemoSession(
                id: "codex-evidence",
                provider: .codex,
                title: "Prepare visual evidence",
                repository: "fixture-harness",
                status: .completed,
                detail: "The screenshot scenario is reproducible"
            ),
        ]
    )
}
