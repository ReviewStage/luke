import Foundation
import Observation

/// Holds what the vault last answered and runs the three acts against it.
/// Every call carries the account's bearer token and follows the same
/// 401 → refresh → retry discipline the sign-in path uses.
@MainActor
@Observable
public final class VaultStore {
    /// The list endpoint's last answer, keyed by provider so no caller builds
    /// a lookup of its own.
    public private(set) var entriesByProvider: [VaultProviderID: VaultKeyEntry] = [:]
    public private(set) var isLoading = false
    public private(set) var loadError: String?

    private let client: VaultClient
    private let session: AccountSession

    public init(client: VaultClient, session: AccountSession) {
        self.client = client
        self.session = session
    }

    public func entry(for provider: VaultProviderID) -> VaultKeyEntry? {
        entriesByProvider[provider]
    }

    /// Fetches the list fresh, first clearing whatever a previous account's
    /// sign-in may have left standing.
    public func load() async {
        entriesByProvider = [:]
        loadError = nil
        isLoading = true
        do {
            try await refreshEntries()
        } catch {
            loadError = VaultStore.message(for: error)
        }
        isLoading = false
    }

    /// Stores or replaces one provider's key, then converges on the server's
    /// own list.
    public func store(key: String, for provider: VaultProviderID) async throws {
        try await authorized { try await self.client.storeKey(key, for: provider, accessToken: $0) }
        // The server's hint is the key's last four characters, so the row can
        // say what landed even when the list round-trip below does not.
        entriesByProvider[provider] = VaultKeyEntry(
            provider: provider,
            hint: String(key.suffix(4)),
            updatedAt: Date()
        )
        try? await refreshEntries()
    }

    /// Removes one provider's key, then converges on the server's own list.
    public func delete(_ provider: VaultProviderID) async throws {
        _ = try await authorized { try await self.client.deleteKey(for: provider, accessToken: $0) }
        entriesByProvider[provider] = nil
        try? await refreshEntries()
    }

    /// One short sentence per failure kind. Never echoes a key.
    public static func message(for error: Error) -> String {
        switch error {
        case AccountSessionError.signedOut:
            return "Sign in again to manage provider keys."
        case VaultClientError.invalidKey:
            return "A key is a single token: no spaces, at most "
                + "\(VaultClient.keyMaxLength) characters."
        case VaultClientError.invalidResponse:
            return "The vault answered with something unexpected. Try again later."
        case VaultClientError.serverError(let status, let apiError):
            switch apiError {
            case .invalidToken: return "Sign in again to manage provider keys."
            case .unavailable: return "The vault is not available right now."
            case .invalidRequest: return "The vault refused the request."
            default: return "The vault request failed (\(status))."
            }
        default:
            return "Could not reach the vault. Check your connection."
        }
    }

    private func refreshEntries() async throws {
        let entries = try await authorized { try await self.client.listKeys(accessToken: $0) }
        entriesByProvider = Dictionary(
            entries.map { ($0.provider, $0) },
            uniquingKeysWith: { _, last in last }
        )
    }

    private func authorized<T>(_ call: (String) async throws -> T) async throws -> T {
        let token = try await session.validAccessToken()
        do {
            return try await call(token)
        } catch VaultClientError.serverError(let status, _) where status == 401 {
            let refreshed = try await session.refreshAccessToken()
            return try await call(refreshed)
        }
    }
}
