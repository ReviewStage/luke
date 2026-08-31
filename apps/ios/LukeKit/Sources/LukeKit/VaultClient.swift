import Foundation

/// The cloud providers whose API keys the hosted vault accepts. Mirrors
/// `VAULT_PROVIDER_ID` in `@sidecar/hosted`: the raw values are the wire ids
/// the vault endpoints take and answer with, and a provider added there needs
/// an entry here before this app can offer it.
public enum VaultProviderID: String, CaseIterable, Identifiable, Sendable {
    case conductor
    case copilot
    case cursor
    case devin
    case jules
    case replicas

    public var id: String { rawValue }

    /// The product-wide name, matching `PROVIDER_IDENTITY_BY_ID` in `@sidecar/session`.
    public var displayName: String {
        switch self {
        case .conductor: "Conductor"
        case .copilot: "Copilot"
        case .cursor: "Cursor"
        case .devin: "Devin"
        case .jules: "Jules"
        case .replicas: "Replicas"
        }
    }

    /// Where the user creates a key, shown in the editor — the same copy the
    /// desktop's credential rows carry in `@sidecar/credentials`.
    public var keyHint: String {
        switch self {
        case .conductor:
            "Create a key in Conductor under Settings · API keys."
        case .copilot:
            "Create a GitHub fine-grained personal access token with Agent tasks read access. "
                + "Classic and installation tokens will not work."
        case .cursor:
            "Create a key in the Cursor dashboard under Integrations · API keys."
        case .devin:
            "Create one on the Devin API settings page, under PATs."
        case .jules:
            "Create a key in Jules under Settings · API key. It is shown only once."
        case .replicas:
            "Create a key in the Replicas dashboard under Personal · API keys."
        }
    }

    /// The page that issues this provider's keys, mirrored from `apiKeysUrl`
    /// in `@sidecar/credentials`. Fixed here so the only addresses the app
    /// can ever open are the ones in this file — the same posture the
    /// desktop keeps by opening key pages by provider id rather than by a
    /// URL its renderer supplies.
    public var keyPageURL: URL {
        let address = switch self {
        case .conductor: "https://app.conductor.build/users/api-keys"
        case .copilot: "https://github.com/settings/personal-access-tokens/new"
        case .cursor: "https://cursor.com/dashboard/api"
        case .devin: "https://app.devin.ai/settings/devin-api?tab=pats"
        case .jules: "https://jules.google.com/settings"
        case .replicas: "https://replicas.dev/dashboard/account/api-keys"
        }
        // swiftlint:disable:next force_unwrapping
        return URL(string: address)!
    }

    /// The only kind of credential Luke will hold for a provider that issues
    /// more than one — the desktop's `CredentialFormat`, mirrored so a key the
    /// service cannot use is refused with a reason instead of stored to fail
    /// quietly. Only Devin publishes a format; the rest accept any key their
    /// provider might issue.
    public var keyFormat: VaultKeyFormat? {
        switch self {
        case .devin:
            VaultKeyFormat(
                label: "Personal access token",
                prefix: "cog_",
                rejection: "Devin's personal access tokens start with cog_. The older apk_ keys "
                    + "are for an API version Luke does not read."
            )
        default:
            nil
        }
    }
}

public struct VaultKeyFormat: Sendable, Equatable {
    /// What the provider itself calls this credential, used where the editor
    /// would otherwise say "API key".
    public let label: String
    public let prefix: String
    /// Said to the user when a key does not carry the prefix, never echoing the key.
    public let rejection: String
}

/// One stored key as the list endpoint reports it: the provider and when it
/// was stored, nothing else. The vault persists and transmits zero fragments
/// of any key — no ciphertext, no plaintext, and since #580 not even a
/// display hint — so this client keeps none either.
public struct VaultKeyEntry: Sendable, Equatable {
    public let provider: VaultProviderID
    public let updatedAt: Date

    public init(provider: VaultProviderID, updatedAt: Date) {
        self.provider = provider
        self.updatedAt = updatedAt
    }
}

/// The refusal reasons a hosted endpoint answers with — `HOSTED_API_ERROR`
/// in `@sidecar/hosted`.
public enum HostedAPIError: String, Sendable {
    case invalidToken = "invalid-token"
    case invalidRequest = "invalid-request"
    case quotaExhausted = "quota-exhausted"
    case unavailable = "unavailable"
    case upstreamError = "upstream-error"
    case methodNotAllowed = "method-not-allowed"
}

public enum VaultClientError: Error, Equatable {
    /// The answer was not the shape the wire contract promises. A malformed
    /// answer is discarded rather than repaired, the same posture as the wire
    /// readers in `@sidecar/hosted`.
    case invalidResponse
    /// The key failed the same shape check the server applies. Refused here so
    /// an unusable key never travels.
    case invalidKey
    case serverError(status: Int, apiError: HostedAPIError?)
}

/// Client for the three hosted vault endpoints. Paths, body shapes, and answer
/// validation mirror the wire contract in `@sidecar/hosted` and the handlers
/// in `apps/web/server/hosted/vault.ts`.
public final class VaultClient: Sendable {
    private let baseURL: URL
    private let http: HTTPClient

    /// `baseURL` is the hosted service origin; the endpoints live under `/api/vault` on it.
    public init(baseURL: URL, http: HTTPClient = URLSession.shared) {
        self.baseURL = baseURL
        self.http = http
    }

    /// Maximum length the server accepts for a provider API key.
    public static let keyMaxLength = 512

    /// The server's own shape check: non-empty, bounded, no whitespace
    /// anywhere. Loose by design — never provider-specific format validation.
    public static func isValidKey(_ key: String) -> Bool {
        !key.isEmpty
            && key.count <= keyMaxLength
            && key.rangeOfCharacter(from: .whitespacesAndNewlines) == nil
    }

    /// Stores or replaces the key for one provider. POST /api/vault/key.
    public func storeKey(_ key: String, for provider: VaultProviderID, accessToken: String)
        async throws
    {
        guard Self.isValidKey(key) else { throw VaultClientError.invalidKey }
        let json = try await send(
            path: "api/vault/key",
            method: "POST",
            body: ["providerId": provider.rawValue, "key": key],
            accessToken: accessToken
        )
        guard json["stored"] as? Bool == true else { throw VaultClientError.invalidResponse }
    }

    /// Lists the stored entries. GET /api/vault/keys.
    ///
    /// Any malformed entry drops the whole answer, mirroring
    /// `vaultKeysListAnswerFromWire`: an unknown provider id means a service
    /// newer than this build, and a partial list would read as keys silently
    /// missing.
    public func listKeys(accessToken: String) async throws -> [VaultKeyEntry] {
        let json = try await send(
            path: "api/vault/keys", method: "GET", body: nil, accessToken: accessToken
        )
        guard let rows = json["keys"] as? [[String: Any]] else {
            throw VaultClientError.invalidResponse
        }
        var entries: [VaultKeyEntry] = []
        for row in rows {
            guard let providerId = row["providerId"] as? String,
                  let provider = VaultProviderID(rawValue: providerId),
                  let updatedAt = row["updatedAt"] as? Double, updatedAt >= 0
            else { throw VaultClientError.invalidResponse }
            entries.append(VaultKeyEntry(
                provider: provider,
                updatedAt: Date(timeIntervalSince1970: updatedAt / 1000)
            ))
        }
        return entries
    }

    /// Removes the key for one provider. DELETE /api/vault/key. Returns
    /// whether a key was there to remove.
    public func deleteKey(for provider: VaultProviderID, accessToken: String) async throws -> Bool {
        let json = try await send(
            path: "api/vault/key",
            method: "DELETE",
            body: ["providerId": provider.rawValue],
            accessToken: accessToken
        )
        guard let deleted = json["deleted"] as? Bool else { throw VaultClientError.invalidResponse }
        return deleted
    }

    private func send(
        path: String,
        method: String,
        body: [String: String]?,
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
            throw VaultClientError.serverError(status: status, apiError: reason)
        }
        return json
    }
}
