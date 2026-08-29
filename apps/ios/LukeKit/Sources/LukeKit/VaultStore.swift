import Foundation
import Observation

/// What the vault needs from the account: whose keys these are, and a bearer
/// for each call. `AccountSession` is the one real source; the protocol
/// exists so tests can stand in a stub without a keychain.
@MainActor
public protocol AccountTokenProviding: AnyObject {
    /// The signed-in account's email, or nil when signed out.
    var accountEmail: String? { get }
    func validAccessToken() async throws -> String
    func refreshAccessToken() async throws -> String
}

/// Holds what the vault last answered and runs the three acts against it.
/// Every call carries the account's bearer token and follows the same
/// 401 → refresh → retry discipline the sign-in path uses.
@MainActor
@Observable
public final class VaultStore {
    public private(set) var isLoading = false
    public private(set) var loadError: String?

    /// The list endpoint's last answer, keyed by provider.
    private var entriesByProvider: [VaultProviderID: VaultKeyEntry] = [:]
    /// The account the entries were loaded for. The store outlives a sign-out,
    /// so entries answer only under the account that earned them — a new
    /// sign-in reads nothing until its own load lands.
    private var entriesAccount: String?
    /// Bumped by every act that makes the standing entries newer than any
    /// answer still in flight, so a slow list response cannot resurrect a
    /// key that was just deleted or hide one that was just stored.
    private var answerGeneration = 0

    private let client: VaultClient
    private let session: any AccountTokenProviding

    public init(client: VaultClient, session: any AccountTokenProviding) {
        self.client = client
        self.session = session
    }

    public func entry(for provider: VaultProviderID) -> VaultKeyEntry? {
        guard let account = session.accountEmail, account == entriesAccount else { return nil }
        return entriesByProvider[provider]
    }

    /// Fetches the list fresh, first clearing whatever a previous account's
    /// sign-in may have left standing.
    public func load() async {
        answerGeneration += 1
        let gen = answerGeneration
        entriesByProvider = [:]
        entriesAccount = session.accountEmail
        loadError = nil
        isLoading = true
        do {
            try await refreshEntries()
        } catch {
            // An act that landed while this load traveled has fresher word on
            // whether the vault answers; its state stands.
            if gen == answerGeneration { loadError = VaultStore.message(for: error) }
        }
        isLoading = false
    }

    /// Stores or replaces one provider's key, then converges on the server's
    /// own list.
    public func store(key: String, for provider: VaultProviderID) async throws {
        try await authorized { try await self.client.storeKey(key, for: provider, accessToken: $0) }
        answerGeneration += 1
        // The vault just answered an act, so a standing load failure is stale.
        loadError = nil
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
        answerGeneration += 1
        loadError = nil
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
            case .invalidToken:
                // Distinct from the signed-out sentence above deliberately:
                // this one only surfaces after a refresh already succeeded and
                // the retry was still refused, so the server rejected a token
                // the account machinery considers fine — a fresh sign-in is
                // the way out, and the words must not blame the local session.
                return "The vault refused this account's token. Sign out and back in."
            case .unavailable: return "The vault is not available right now."
            case .invalidRequest: return "The vault refused the request."
            default: return "The vault request failed (\(status))."
            }
        default:
            return "Could not reach the vault. Check your connection."
        }
    }

    private func refreshEntries() async throws {
        let gen = answerGeneration
        let entries = try await authorized { try await self.client.listKeys(accessToken: $0) }
        // A newer act, or another account's sign-in, landed while this answer
        // traveled; its state wins.
        guard gen == answerGeneration, entriesAccount == session.accountEmail else { return }
        entriesByProvider = Dictionary(
            entries.map { ($0.provider, $0) },
            uniquingKeysWith: { _, last in last }
        )
    }

    /// Runs one authorized call for the account signed in when it was asked.
    /// Every step that could pick up a different account's credential — the
    /// initial token read, the 401 retry's refresh, the replay — re-checks
    /// that the account still stands, because a retry that changed hands
    /// mid-flight would carry one account's act (and a pasted key) into
    /// another account's vault.
    private func authorized<T>(_ call: (String) async throws -> T) async throws -> T {
        guard let account = session.accountEmail else { throw AccountSessionError.signedOut }
        let token = try await session.validAccessToken()
        guard session.accountEmail == account else { throw AccountSessionError.signedOut }
        do {
            return try await call(token)
        } catch VaultClientError.serverError(let status, _) where status == 401 {
            guard session.accountEmail == account else { throw AccountSessionError.signedOut }
            let refreshed = try await session.refreshAccessToken()
            guard session.accountEmail == account else { throw AccountSessionError.signedOut }
            return try await call(refreshed)
        }
    }
}
