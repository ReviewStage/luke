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

    public var id: String { "\(providerId):\(sessionId)" }

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
    }
}
