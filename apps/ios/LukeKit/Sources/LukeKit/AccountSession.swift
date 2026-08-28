import Foundation
import Observation

public enum AuthState: Equatable {
    case signedOut
    case signedIn(AccountIdentity)

    public static func == (lhs: AuthState, rhs: AuthState) -> Bool {
        switch (lhs, rhs) {
        case (.signedOut, .signedOut): return true
        case let (.signedIn(a), .signedIn(b)):
            return a.email == b.email && a.id == b.id && a.name == b.name
        default: return false
        }
    }
}

/// Manages the sign-in state and token lifecycle.
///
/// The 401 → refresh → retry discipline mirrors the desktop SessionManager:
/// a userInfo call that returns 401 triggers one token refresh, then retries.
/// A refresh that itself fails with a 4xx (indicating the refresh token is
/// rejected) signs the user out rather than leaving a broken session.
@MainActor
@Observable
public final class AccountSession {
    public private(set) var state: AuthState = .signedOut

    private let client: AccountClient
    // Incremented on every sign-out so an in-flight restore refresh cannot write
    // back after the user has already asked to leave (mirrors the desktop generation counter).
    private var generation = 0

    public init(client: AccountClient) {
        self.client = client
        restoreFromKeychain()
    }

    public func completeSignIn(code: String, verifier: String) async throws {
        let tokens = try await client.exchangeCode(
            code: code,
            codeVerifier: verifier,
            redirectURI: AccountConstants.redirectURI
        )
        storeTokens(tokens)
        let identity = try await resolvedIdentity(accessToken: tokens.accessToken,
                                                   refreshToken: tokens.refreshToken)
        storeIdentity(identity)
        state = .signedIn(identity)
    }

    public func signOut() async {
        generation += 1
        let refreshToken = KeychainStore.get(.refreshToken)
        KeychainStore.clearAll()
        state = .signedOut
        if let token = refreshToken {
            try? await client.revoke(refreshToken: token)
        }
    }

    // MARK: - Private

    private func restoreFromKeychain() {
        guard let accessToken = KeychainStore.get(.accessToken),
              let email = KeychainStore.get(.email)
        else { return }
        let identity = AccountIdentity(
            id: KeychainStore.get(.accountID),
            email: email,
            name: KeychainStore.get(.name)
        )
        state = .signedIn(identity)
        let gen = generation
        Task { [weak self] in
            guard let self else { return }
            await self.refreshIfNearExpiry(accessToken: accessToken, generation: gen)
        }
    }

    private func refreshIfNearExpiry(accessToken: String, generation: Int) async {
        let shouldRefresh: Bool = {
            guard let expiryStr = KeychainStore.get(.expiry),
                  let expiryInterval = TimeInterval(expiryStr)
            else { return true }
            let expiry = Date(timeIntervalSinceReferenceDate: expiryInterval)
            return expiry.timeIntervalSinceNow < 300
        }()
        guard shouldRefresh, let refreshToken = KeychainStore.get(.refreshToken) else { return }
        do {
            let tokens = try await client.refresh(refreshToken: refreshToken)
            guard self.generation == generation else { return }
            storeTokens(tokens)
            let identity = try await client.userInfo(accessToken: tokens.accessToken)
            guard self.generation == generation else { return }
            storeIdentity(identity)
            state = .signedIn(identity)
        } catch AccountClientError.serverError(let status, _) where (400 ..< 500).contains(status) {
            guard self.generation == generation else { return }
            // Refresh token rejected — clear the dead session rather than leaving the user stuck.
            await signOut()
        } catch {
            // Transient network failure; the stored tokens may still be valid.
        }
    }

    /// Fetches userinfo, refreshing once on 401 (mirrors the desktop 401 → refresh → retry).
    private func resolvedIdentity(accessToken: String, refreshToken: String) async throws
        -> AccountIdentity
    {
        do {
            return try await client.userInfo(accessToken: accessToken)
        } catch AccountClientError.serverError(let status, _) where status == 401 {
            let refreshed = try await client.refresh(refreshToken: refreshToken)
            storeTokens(refreshed)
            return try await client.userInfo(accessToken: refreshed.accessToken)
        }
    }

    private func storeTokens(_ tokens: AccountTokens) {
        KeychainStore.set(tokens.accessToken, for: .accessToken)
        KeychainStore.set(tokens.refreshToken, for: .refreshToken)
        KeychainStore.set(
            String(tokens.expiry.timeIntervalSinceReferenceDate),
            for: .expiry
        )
    }

    private func storeIdentity(_ identity: AccountIdentity) {
        KeychainStore.set(identity.email, for: .email)
        if let id = identity.id { KeychainStore.set(id, for: .accountID) }
        if let name = identity.name { KeychainStore.set(name, for: .name) }
    }
}
