import Foundation

// MARK: - Wire models

/// The three outcomes a hosted act endpoint can return.
/// Mirrors `HOSTED_ACT_RESULT` in `@sidecar/hosted`.
public enum ActResult: String, Codable, Equatable, Sendable {
    case accepted
    case rejected
    case unsupported
}

/// The answer returned by `POST /api/acts/message`.
public struct ActMessageAnswer: Codable, Equatable, Sendable {
    public let result: ActResult
    public let reason: String?

    public init(result: ActResult, reason: String?) {
        self.result = result
        self.reason = reason
    }
}

/// The answer returned by `POST /api/acts/workspace`.
public struct ActWorkspaceAnswer: Codable, Equatable, Sendable {
    public let result: ActResult
    public let reason: String?
    /// The created session's provider id, when the provider reports one.
    public let providerSessionId: String?

    public init(result: ActResult, reason: String?, providerSessionId: String?) {
        self.result = result
        self.reason = reason
        self.providerSessionId = providerSessionId
    }
}

// MARK: - Errors

public enum ActClientError: Error, Equatable {
    case invalidResponse
    case unauthorized
    case serverError(status: Int)
}

// MARK: - Client

/// HTTP client for Luke's hosted act endpoints.
///
/// Acts are the write path for cloud sessions: message a session that is
/// accepting messages, run a control its provider advertised, start another
/// agent in its workspace, rename it or its workspace, or create a workspace
/// in a provider project.
///
/// Text bounds (`sessionMessageText` / `workspaceNameText`) are enforced on
/// the server. The client trims text before sending as a courtesy.
public final class ActClient: Sendable {
    private let baseURL: URL
    private let http: HTTPClient

    public init(baseURL: URL, http: HTTPClient = URLSession.shared) {
        self.baseURL = baseURL
        self.http = http
    }

    /// Sends a message to a cloud session.
    ///
    /// The server re-observes the session's status before writing. If the
    /// session is not currently accepting messages the answer is `rejected`
    /// with a human-readable reason.
    public func sendMessage(
        accessToken: String,
        providerId: String,
        providerSessionId: String,
        text: String
    ) async throws -> ActMessageAnswer {
        let url = baseURL.appendingPathComponent("api/acts/message")
        let body: [String: String] = [
            "providerId": providerId,
            "providerSessionId": providerSessionId,
            "text": text.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        return try await post(url: url, body: body, accessToken: accessToken)
    }

    /// Runs a control the session's latest observation advertised (stop a
    /// turn, archive a settled workspace, approve a plan).
    ///
    /// The server re-observes before writing: a control the fresh pass no
    /// longer advertises answers `rejected` rather than landing on a session
    /// that moved on.
    public func executeControl(
        accessToken: String,
        providerId: String,
        providerSessionId: String,
        controlId: String
    ) async throws -> ActMessageAnswer {
        let url = baseURL.appendingPathComponent("api/acts/control")
        let body: [String: String] = [
            "providerId": providerId,
            "providerSessionId": providerSessionId,
            "controlId": controlId,
        ]
        return try await post(url: url, body: body, accessToken: accessToken)
    }

    /// Starts another agent in the workspace an observed session runs in.
    ///
    /// `agent` must be one of the kinds the session's latest observation
    /// listed as spawnable; the server re-observes and validates it again.
    public func spawnAgent(
        accessToken: String,
        providerId: String,
        providerSessionId: String,
        agent: String,
        name: String? = nil,
        task: String? = nil
    ) async throws -> ActWorkspaceAnswer {
        let url = baseURL.appendingPathComponent("api/acts/agent")
        var body: [String: String] = [
            "providerId": providerId,
            "providerSessionId": providerSessionId,
            "agent": agent,
        ]
        if let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            body["name"] = name
        }
        if let task = task?.trimmingCharacters(in: .whitespacesAndNewlines), !task.isEmpty {
            body["task"] = task
        }
        return try await post(url: url, body: body, accessToken: accessToken)
    }

    /// Renames an observed session itself — the chat.
    public func renameSession(
        accessToken: String,
        providerId: String,
        providerSessionId: String,
        name: String
    ) async throws -> ActMessageAnswer {
        let url = baseURL.appendingPathComponent("api/acts/rename-session")
        let body: [String: String] = [
            "providerId": providerId,
            "providerSessionId": providerSessionId,
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        return try await post(url: url, body: body, accessToken: accessToken)
    }

    /// Renames the workspace an observed session runs in.
    public func renameWorkspace(
        accessToken: String,
        providerId: String,
        providerSessionId: String,
        name: String
    ) async throws -> ActMessageAnswer {
        let url = baseURL.appendingPathComponent("api/acts/rename-workspace")
        let body: [String: String] = [
            "providerId": providerId,
            "providerSessionId": providerSessionId,
            "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        return try await post(url: url, body: body, accessToken: accessToken)
    }

    /// Creates a workspace in a cloud project.
    ///
    /// `name` and `task` are optional. The server bounds them before passing
    /// them to the provider.
    public func createWorkspace(
        accessToken: String,
        providerId: String,
        providerProjectId: String,
        name: String? = nil,
        task: String? = nil
    ) async throws -> ActWorkspaceAnswer {
        let url = baseURL.appendingPathComponent("api/acts/workspace")
        var body: [String: String] = [
            "providerId": providerId,
            "providerProjectId": providerProjectId,
        ]
        if let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            body["name"] = name
        }
        if let task = task?.trimmingCharacters(in: .whitespacesAndNewlines), !task.isEmpty {
            body["task"] = task
        }
        return try await post(url: url, body: body, accessToken: accessToken)
    }

    // MARK: - Private

    private func post<T: Decodable>(
        url: URL,
        body: [String: String],
        accessToken: String
    ) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw ActClientError.unauthorized }
        guard (200 ..< 300).contains(status) else { throw ActClientError.serverError(status: status) }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ActClientError.invalidResponse
        }
    }
}
