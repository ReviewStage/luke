import Foundation

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
        observedAt: Date? = nil
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
    }
}
