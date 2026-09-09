import Foundation

public struct AccountPreferencesAnswer: Sendable, Equatable {
    public let preferences: DeviceSettingsSnapshot
    public let hasStoredSnapshot: Bool

    public init(preferences: DeviceSettingsSnapshot, hasStoredSnapshot: Bool = false) {
        self.preferences = preferences
        self.hasStoredSnapshot = hasStoredSnapshot
    }
}

public enum AccountPreferencesClientError: Error, Equatable {
    case invalidResponse
    case serverError(status: Int, apiError: HostedAPIError?)
}

private enum AccountPreferenceWireField {
    static let voice = "voice"
    static let voiceSpeed = "voiceSpeed"
    static let defaultWorkspaceProvider = "defaultWorkspaceProvider"
    static let workspaceProjectDefaults = "workspaceProjectDefaults"
    static let workspaceAgentDefaults = "workspaceAgentDefaults"
    static let agent = "agent"
    static let model = "model"
    static let effort = "effort"

    static let topLevel: Set<String> = [
        voice,
        voiceSpeed,
        defaultWorkspaceProvider,
        workspaceProjectDefaults,
        workspaceAgentDefaults,
    ]
}

private let workspaceProviderIds: Set<String> = ["codex", "conductor", "superset"]
private let supersetWorkspaceProviderId = "superset"
private let maximumWorkspaceProjectIdLength = 500

private func hostedVoiceSpeed(_ value: Any) -> RealtimeVoiceSpeed? {
    if value is Bool { return nil }
    if let number = value as? NSNumber {
        return RealtimeVoiceSpeed(multiplier: number.doubleValue)
    }
    if let number = value as? Double {
        return RealtimeVoiceSpeed(multiplier: number)
    }
    return nil
}

private func hostedMilliseconds(_ value: Any) -> Double? {
    if value is Bool { return nil }
    let milliseconds: Double
    if let number = value as? NSNumber {
        milliseconds = number.doubleValue
    } else if let number = value as? Double {
        milliseconds = number
    } else {
        return nil
    }
    return milliseconds >= 0 ? milliseconds : nil
}

private func isWorkspaceProviderId(_ value: String) -> Bool {
    workspaceProviderIds.contains(value)
}

private func isSupersetAgentKind(_ value: String) -> Bool {
    guard !value.isEmpty, value.count <= 80 else { return false }
    return value.range(of: #"^[a-z0-9][a-z0-9-]*$"#, options: .regularExpression) != nil
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
        let hasStoredSnapshot: Bool
        if let stamp = json["updatedAt"] {
            guard hostedMilliseconds(stamp) != nil else {
                throw AccountPreferencesClientError.invalidResponse
            }
            hasStoredSnapshot = true
        } else {
            hasStoredSnapshot = false
        }
        guard let parsed = DeviceSettingsSnapshot(accountPreferencesWire: preferences) else {
            throw AccountPreferencesClientError.invalidResponse
        }
        return AccountPreferencesAnswer(
            preferences: parsed,
            hasStoredSnapshot: hasStoredSnapshot
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
        if voice != .default { wire[AccountPreferenceWireField.voice] = voice.rawValue }
        if speed != .default { wire[AccountPreferenceWireField.voiceSpeed] = speed.multiplier }
        if let workspaceProviderId {
            wire[AccountPreferenceWireField.defaultWorkspaceProvider] = workspaceProviderId
        }
        if !workspaceProjectIds.isEmpty {
            wire[AccountPreferenceWireField.workspaceProjectDefaults] = workspaceProjectIds
        }
        if !workspaceAgentDefaults.isEmpty {
            wire[AccountPreferenceWireField.workspaceAgentDefaults] = workspaceAgentDefaults.mapValues { selection in
                var fields = [AccountPreferenceWireField.agent: selection.agent]
                if let model = selection.model { fields[AccountPreferenceWireField.model] = model }
                if let effort = selection.effort { fields[AccountPreferenceWireField.effort] = effort }
                return fields
            }
        }
        return wire
    }

    public init?(accountPreferencesWire wire: [String: Any]) {
        for key in wire.keys where !AccountPreferenceWireField.topLevel.contains(key) {
            return nil
        }

        var voice = RealtimeVoice.default
        if let rawVoice = wire[AccountPreferenceWireField.voice] {
            guard let name = rawVoice as? String, let parsed = RealtimeVoice(rawValue: name)
            else { return nil }
            voice = parsed
        }

        var speed = RealtimeVoiceSpeed.default
        if let rawSpeed = wire[AccountPreferenceWireField.voiceSpeed] {
            guard let parsed = hostedVoiceSpeed(rawSpeed) else { return nil }
            speed = parsed
        }

        var workspaceProviderId: String?
        if let rawProvider = wire[AccountPreferenceWireField.defaultWorkspaceProvider] {
            guard let provider = rawProvider as? String, isWorkspaceProviderId(provider)
            else { return nil }
            workspaceProviderId = provider
        }

        var workspaceProjectIds: [String: String] = [:]
        if let rawProjects = wire[AccountPreferenceWireField.workspaceProjectDefaults] {
            guard let projects = rawProjects as? [String: Any] else { return nil }
            for (provider, rawProjectId) in projects {
                guard isWorkspaceProviderId(provider), let projectId = rawProjectId as? String else {
                    return nil
                }
                let trimmed = projectId.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty, trimmed.count <= maximumWorkspaceProjectIdLength else {
                    return nil
                }
                workspaceProjectIds[provider] = trimmed
            }
        }

        var workspaceAgentDefaults: [String: WorkspaceAgentDefault] = [:]
        if let rawAgents = wire[AccountPreferenceWireField.workspaceAgentDefaults] {
            guard let agents = rawAgents as? [String: Any] else { return nil }
            for (provider, rawFields) in agents {
                guard isWorkspaceProviderId(provider), let fields = rawFields as? [String: Any],
                      let agent = fields[AccountPreferenceWireField.agent] as? String
                else { return nil }
                if provider == supersetWorkspaceProviderId {
                    guard fields[AccountPreferenceWireField.model] == nil,
                          fields[AccountPreferenceWireField.effort] == nil,
                          isSupersetAgentKind(agent)
                    else { return nil }
                    workspaceAgentDefaults[provider] = WorkspaceAgentDefault(agent: agent)
                    continue
                }
                guard let model = fields[AccountPreferenceWireField.model] as? String,
                      !agent.isEmpty, !model.isEmpty
                else { return nil }
                if let effort = fields[AccountPreferenceWireField.effort], !(effort is String) {
                    return nil
                }
                workspaceAgentDefaults[provider] = WorkspaceAgentDefault(
                    agent: agent,
                    model: model,
                    effort: fields[AccountPreferenceWireField.effort] as? String
                )
            }
        }

        self.init(
            voice: voice,
            speed: speed,
            workspaceProviderId: workspaceProviderId,
            workspaceProjectIds: workspaceProjectIds,
            workspaceAgentDefaults: workspaceAgentDefaults
        )
    }
}
