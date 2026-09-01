import Foundation

/// The ephemeral Realtime connection the mobile mint endpoint returns.
public struct VoiceConnection: Sendable {
    public let ephemeralKey: String
    public let wsURL: URL
    public let expiresAt: Date
    public let model: String
    /// Pre-serialized session context drawn from the vault-observed sessions on
    /// the server, ready to send as the first conversation item on connect.
    public let sessionsContext: VoiceContextItem
}

/// A context item from the mint — an opaque, pre-formatted block of text the
/// session sends to the model at channel open so it knows the running sessions.
public struct VoiceContextItem: Sendable {
    public let itemId: String
    public let text: String
}

public enum VoiceMintClientError: Error, Equatable {
    /// The response shape does not match the wire contract in `@sidecar/hosted`.
    case invalidResponse
    case quotaExhausted
    case serverError(status: Int, apiError: HostedAPIError?)
}

/// HTTP client for `POST /api/voice/mobile-mint`. Validates the wire response
/// against the contract in `@sidecar/hosted`.
public final class VoiceMintClient: Sendable {
    private let baseURL: URL
    private let http: HTTPClient

    public init(baseURL: URL, http: HTTPClient = URLSession.shared) {
        self.baseURL = baseURL
        self.http = http
    }

    /// Mints an ephemeral Realtime credential and returns the connection
    /// details plus a pre-serialized session context.
    public func mint(accessToken: String, voice: String? = nil, speed: Double? = nil)
        async throws -> VoiceConnection
    {
        var body: [String: Any] = [:]
        if let voice { body["voice"] = voice }
        if let speed { body["speed"] = speed }

        var request = URLRequest(url: baseURL.appendingPathComponent("api/voice/mobile-mint"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]

        guard (200 ..< 300).contains(status) else {
            let reason = (json["error"] as? String).flatMap(HostedAPIError.init(rawValue:))
            if reason == .quotaExhausted { throw VoiceMintClientError.quotaExhausted }
            throw VoiceMintClientError.serverError(status: status, apiError: reason)
        }

        return try parseConnection(from: json)
    }

    private func parseConnection(from json: [String: Any]) throws -> VoiceConnection {
        guard
            let conn = json["connection"] as? [String: Any],
            let value = conn["value"] as? String, !value.isEmpty,
            let expiresAtMs = conn["expiresAt"] as? Double, expiresAtMs > 0,
            let model = conn["model"] as? String, !model.isEmpty,
            let wsUrlStr = conn["wsUrl"] as? String,
            let wsURL = URL(string: wsUrlStr),
            wsURL.scheme == "wss"
        else { throw VoiceMintClientError.invalidResponse }

        guard
            let ctx = json["context"] as? [String: Any],
            let sessions = ctx["sessions"] as? [String: Any],
            let itemId = sessions["itemId"] as? String, !itemId.isEmpty,
            let text = sessions["text"] as? String, !text.isEmpty
        else { throw VoiceMintClientError.invalidResponse }

        return VoiceConnection(
            ephemeralKey: value,
            wsURL: wsURL,
            expiresAt: Date(timeIntervalSince1970: expiresAtMs / 1000),
            model: model,
            sessionsContext: VoiceContextItem(itemId: itemId, text: text)
        )
    }
}
