import Foundation

public struct AccountPreferencesAnswer: Sendable, Equatable {
    public let preferences: DeviceSettingsSnapshot
    public let updatedAt: Date?

    public init(preferences: DeviceSettingsSnapshot, updatedAt: Date? = nil) {
        self.preferences = preferences
        self.updatedAt = updatedAt
    }
}

public enum AccountPreferencesClientError: Error, Equatable {
    case invalidResponse
    case serverError(status: Int, apiError: HostedAPIError?)
}

private func hostedVoiceSpeed(_ value: Any?) -> RealtimeVoiceSpeed? {
    if let number = value as? NSNumber {
        return RealtimeVoiceSpeed(multiplier: number.doubleValue)
    }
    if let number = value as? Double {
        return RealtimeVoiceSpeed(multiplier: number)
    }
    return nil
}

/// Client for the account preferences endpoint. It sends only the cross-device
/// preferences held by `DeviceSettingsSnapshot`; missing voice and speed values
/// mean the shared defaults, so a reset clears the account choice rather than
/// writing a copy of the default.
public final class AccountPreferencesClient: Sendable {
    private let baseURL: URL
    private let http: HTTPClient

    public init(baseURL: URL, http: HTTPClient = URLSession.shared) {
        self.baseURL = baseURL
        self.http = http
    }

    public func readPreferences(accessToken: String) async throws -> AccountPreferencesAnswer {
        let json = try await send(
            path: "api/account/preferences", method: "GET", body: nil, accessToken: accessToken
        )
        return try Self.answer(from: json)
    }

    public func writePreferences(_ snapshot: DeviceSettingsSnapshot, accessToken: String)
        async throws -> AccountPreferencesAnswer
    {
        let json = try await send(
            path: "api/account/preferences",
            method: "PUT",
            body: ["preferences": snapshot.accountPreferencesWire],
            accessToken: accessToken
        )
        return try Self.answer(from: json)
    }

    private static func answer(from json: [String: Any]) throws -> AccountPreferencesAnswer {
        guard let preferences = json["preferences"] as? [String: Any] else {
            throw AccountPreferencesClientError.invalidResponse
        }
        var updatedAt: Date?
        if let stamp = json["updatedAt"] {
            guard let milliseconds = stamp as? Double, milliseconds >= 0 else {
                throw AccountPreferencesClientError.invalidResponse
            }
            updatedAt = Date(timeIntervalSince1970: milliseconds / 1000)
        }
        return AccountPreferencesAnswer(
            preferences: DeviceSettingsSnapshot(accountPreferencesWire: preferences),
            updatedAt: updatedAt
        )
    }

    private func send(
        path: String,
        method: String,
        body: [String: Any]?,
        accessToken: String
    ) async throws -> [String: Any] {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard (200 ..< 300).contains(status) else {
            let reason = (json["error"] as? String).flatMap(HostedAPIError.init(rawValue:))
            throw AccountPreferencesClientError.serverError(status: status, apiError: reason)
        }
        return json
    }
}

extension DeviceSettingsSnapshot {
    public var accountPreferencesWire: [String: Any] {
        var wire: [String: Any] = [:]
        if voice != .default { wire["voice"] = voice.rawValue }
        if speed != .default { wire["voiceSpeed"] = speed.multiplier }
        if let workspaceProviderId { wire["defaultWorkspaceProvider"] = workspaceProviderId }
        if !workspaceProjectIds.isEmpty { wire["workspaceProjectDefaults"] = workspaceProjectIds }
        if !workspaceAgentDefaults.isEmpty {
            wire["workspaceAgentDefaults"] = workspaceAgentDefaults.mapValues { selection in
                var fields = ["agent": selection.agent]
                if let model = selection.model { fields["model"] = model }
                if let effort = selection.effort { fields["effort"] = effort }
                return fields
            }
        }
        return wire
    }

    public init(accountPreferencesWire wire: [String: Any]) {
        let agents = (wire["workspaceAgentDefaults"] as? [String: [String: String]] ?? [:])
            .compactMapValues { fields -> WorkspaceAgentDefault? in
                guard let agent = fields["agent"] else { return nil }
                return WorkspaceAgentDefault(agent: agent, model: fields["model"], effort: fields["effort"])
            }
        self.init(
            voice: (wire["voice"] as? String).flatMap(RealtimeVoice.init(rawValue:)) ?? .default,
            speed: hostedVoiceSpeed(wire["voiceSpeed"]) ?? .default,
            workspaceProviderId: wire["defaultWorkspaceProvider"] as? String,
            workspaceProjectIds: wire["workspaceProjectDefaults"] as? [String: String] ?? [:],
            workspaceAgentDefaults: agents
        )
    }
}
