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

/// One model a provider's creation endpoint takes: the id the endpoint takes
/// beside the name a person reads.
public struct WorkspaceAgentModelChoice: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

/// One agent kind a provider's creation endpoint takes, with the models and
/// effort levels the build's table lists for it. Mirrors the
/// `HostedWorkspaceAgentModels` wire shape from `@sidecar/hosted` — the same
/// table the desktop offers from, so the two surfaces can never disagree
/// about what exists.
public struct WorkspaceAgentOption: Identifiable, Equatable, Sendable {
    public let providerId: String
    public let agent: String
    public let models: [WorkspaceAgentModelChoice]
    public let efforts: [String]

    public var id: String { "\(providerId):\(agent)" }

    public init(providerId: String, agent: String, models: [WorkspaceAgentModelChoice], efforts: [String]) {
        self.providerId = providerId
        self.agent = agent
        self.models = models
        self.efforts = efforts
    }

    init?(json: [String: Any]) {
        guard
            let providerId = json["providerId"] as? String,
            let agent = json["agent"] as? String,
            let modelsJSON = json["models"] as? [[String: Any]]
        else { return nil }
        let models = modelsJSON.compactMap { model -> WorkspaceAgentModelChoice? in
            guard
                let id = model["id"] as? String, !id.isEmpty,
                let label = model["label"] as? String, !label.isEmpty
            else { return nil }
            return WorkspaceAgentModelChoice(id: id, label: label)
        }
        guard !models.isEmpty else { return nil }
        self.providerId = providerId
        self.agent = agent
        self.models = models
        self.efforts = (json["efforts"] as? [String] ?? []).filter { !$0.isEmpty }
    }
}

/// The projects endpoint answer: where a workspace can be created, and the
/// agent choices each of those providers' creation endpoints take.
public struct ProjectsAnswer: Equatable, Sendable {
    public let projects: [RosterProject]
    public let agentModels: [WorkspaceAgentOption]

    public init(projects: [RosterProject], agentModels: [WorkspaceAgentOption]) {
        self.projects = projects
        self.agentModels = agentModels
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

    /// Returns the caller's reported projects and agent choices.
    public func projects(bearerToken: String) async throws -> ProjectsAnswer {
        var request = URLRequest(url: serviceURL.appendingPathComponent("api/projects"))
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            throw ProjectsClientError.serverError(status: status)
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ProjectsAnswer(projects: [], agentModels: [])
        }
        let projectsJSON = json["projects"] as? [[String: Any]] ?? []
        let agentsJSON = json["agentModels"] as? [[String: Any]] ?? []
        return ProjectsAnswer(
            projects: projectsJSON.compactMap { RosterProject(json: $0) },
            agentModels: agentsJSON.compactMap { WorkspaceAgentOption(json: $0) }
        )
    }
}
