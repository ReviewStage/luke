import Foundation

public enum RosterClientError: LocalizedError {
    case serverError(status: Int)

    public var errorDescription: String? {
        switch self {
        case .serverError(let status):
            return "Observe endpoint returned HTTP \(status)"
        }
    }
}

extension RosterClientError: HostedUnauthorizedSignaling {
    public var isUnauthorized: Bool {
        if case .serverError(let status) = self { return status == 401 }
        return false
    }
}

/// Fetches the signed-in user's cloud sessions from the observe endpoint.
public final class RosterClient: Sendable {
    private let serviceURL: URL
    private let http: HTTPClient

    public init(serviceURL: URL, http: HTTPClient = URLSession.shared) {
        self.serviceURL = serviceURL
        self.http = http
    }

    /// Returns the caller's active cloud sessions, or an empty array when none are running.
    public func observe(bearerToken: String) async throws -> [RosterSession] {
        var request = URLRequest(url: serviceURL.appendingPathComponent("api/observe"))
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            throw RosterClientError.serverError(status: status)
        }
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let sessionsJSON = json["sessions"] as? [[String: Any]]
        else { return [] }
        return sessionsJSON.compactMap { RosterSession(json: $0) }
    }
}
