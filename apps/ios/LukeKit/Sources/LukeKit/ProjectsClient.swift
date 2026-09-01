import Foundation

/// Whether a new workspace in a project takes — or needs — an opening task.
/// Mirrors `WORKSPACE_TASK_SUPPORT` in `@sidecar/session`.
public enum ProjectTaskSupport: String, Sendable {
    case none
    case optional
    case required
}

/// One place a new workspace can be created, as the projects endpoint reports
/// it. Mirrors the `HostedWorkspaceProject` wire shape from `@sidecar/hosted`:
/// a project the provider itself listed on a fresh observation pass, so a
/// creation ask can only ever name a reported project.
public struct RosterProject: Identifiable, Equatable, Sendable {
    public let providerId: String
    public let providerProjectId: String
    public let repository: String
    public let taskSupport: ProjectTaskSupport
    /// The label of the execution target owning this project, when it has one.
    public let targetName: String?

    public var id: String { "\(providerId):\(providerProjectId)" }

    public init(
        providerId: String,
        providerProjectId: String,
        repository: String,
        taskSupport: ProjectTaskSupport,
        targetName: String? = nil
    ) {
        self.providerId = providerId
        self.providerProjectId = providerProjectId
        self.repository = repository
        self.taskSupport = taskSupport
        self.targetName = targetName
    }

    init?(json: [String: Any]) {
        guard
            let providerId = json["providerId"] as? String,
            let providerProjectId = json["providerProjectId"] as? String,
            let repository = json["repository"] as? String,
            let rawTaskSupport = json["taskSupport"] as? String,
            let taskSupport = ProjectTaskSupport(rawValue: rawTaskSupport)
        else { return nil }
        self.providerId = providerId
        self.providerProjectId = providerProjectId
        self.repository = repository
        self.taskSupport = taskSupport
        self.targetName = json["targetName"] as? String
    }
}

public enum ProjectsClientError: LocalizedError {
    case serverError(status: Int)

    public var errorDescription: String? {
        switch self {
        case .serverError(let status):
            return "Projects endpoint returned HTTP \(status)"
        }
    }
}

/// Fetches where the signed-in user's keys can create a workspace.
public final class ProjectsClient: Sendable {
    private let serviceURL: URL
    private let http: HTTPClient

    public init(serviceURL: URL, http: HTTPClient = URLSession.shared) {
        self.serviceURL = serviceURL
        self.http = http
    }

    /// Returns the caller's reported projects, or an empty array when none.
    public func projects(bearerToken: String) async throws -> [RosterProject] {
        var request = URLRequest(url: serviceURL.appendingPathComponent("api/projects"))
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            throw ProjectsClientError.serverError(status: status)
        }
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let projectsJSON = json["projects"] as? [[String: Any]]
        else { return [] }
        return projectsJSON.compactMap { RosterProject(json: $0) }
    }
}
