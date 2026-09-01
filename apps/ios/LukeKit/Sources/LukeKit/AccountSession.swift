import Foundation
import Observation

public enum AccountSessionError: Error, Equatable {
    /// No usable credential stands — never signed in, signed out mid-flight,
    /// or the refresh token was rejected outright.
    case signedOut
}

public enum AuthState: Equatable {
    case signedOut
    case signedIn(AccountIdentity)

    public static func == (lhs: AuthState, rhs: AuthState) -> Bool {
        switch (lhs, rhs) {
        case (.signedOut, .signedOut): return true
        case let (.signedIn(a), .signedIn(b)):
            return a.email == b.email && a.id == b.id && a.name == b.name
                && a.pictureURL == b.pictureURL
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

    /// False when the keychain refused to store this sign-in's credentials.
    /// The session still works — the running process's tokens live in memory —
    /// but the next launch starts signed out, and the surface should say so.
    public private(set) var credentialsPersisted = true

    // The running session's credentials. Memory is the source of truth and
    // the keychain is persistence, because a keychain that refuses writes (an
    // unsigned development build on a fresh simulator) would otherwise leave
    // a signed-in card whose every authorized call fails.
    private var accessToken: String?
    private var refreshToken: String?
    private var accessTokenExpiry: Date?

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
        let identity = try await resolvedIdentity(accessToken: tokens.accessToken)
        storeIdentity(identity)
        state = .signedIn(identity)
    }

    /// Returns the stored access token when signed in, or nil when signed out.
    public func currentAccessToken() -> String? {
        guard case .signedIn = state else { return nil }
        return KeychainStore.get(.accessToken)
    }

    public func signOut() async {
        generation += 1
        let tokenToRevoke = refreshToken
        accessToken = nil
        refreshToken = nil
        accessTokenExpiry = nil
        KeychainStore.clearAll()
        state = .signedOut
        if let token = tokenToRevoke {
            try? await client.revoke(refreshToken: token)
        }
    }

    /// The access token an authorized hosted call should carry, refreshed
    /// first when the stored one is near expiry (the restore path's window).
    /// A refresh that merely failed hands back the stored token, which may
    /// still work; one the server rejected outright has already signed out.
    public func validAccessToken() async throws -> String {
        guard case .signedIn = state, let accessToken else {
            throw AccountSessionError.signedOut
        }
        guard tokenIsNearExpiry else { return accessToken }
        if let refreshed = try? await refreshAccessToken() { return refreshed }
        guard case .signedIn = state else { throw AccountSessionError.signedOut }
        return accessToken
    }

    /// Mints a fresh access token — the retry half of the 401 → refresh →
    /// retry discipline, for a caller whose first attempt was refused. A
    /// refresh rejected as invalid_grant signs the user out, mirroring the
    /// restore path.
    public func refreshAccessToken() async throws -> String {
        try await refreshStoredTokens().accessToken
    }

    // MARK: - Private

    private var refreshInFlight: Task<AccountTokens, Error>?

    /// Spends the stored refresh token at most once however many callers
    /// race: the server rotates the token on use, so a second concurrent
    /// spend would read as revocation and sign the user out. Concurrent
    /// callers await the same in-flight request instead. The slot lives
    /// exactly as long as the request — cleared by the task itself, never by
    /// a waiter, because awaiting a task's value throws on the waiter's own
    /// cancellation (a view's teardown) while the request is still in flight.
    private func refreshStoredTokens() async throws -> AccountTokens {
        if let inFlight = refreshInFlight { return try await inFlight.value }
        let task = Task { () throws -> AccountTokens in
            defer { self.refreshInFlight = nil }
            return try await self.performRefresh()
        }
        refreshInFlight = task
        return try await task.value
    }

    private func performRefresh() async throws -> AccountTokens {
        guard let refreshToken else {
            throw AccountSessionError.signedOut
        }
        let gen = generation
        do {
            let tokens = try await client.refresh(refreshToken: refreshToken)
            guard self.generation == gen else { throw AccountSessionError.signedOut }
            storeTokens(tokens)
            return tokens
        } catch AccountClientError.serverError(_, let oauthError) where oauthError == "invalid_grant" {
            // Permanently revoked — sign out rather than leaving a broken session.
            if self.generation == gen { await signOut() }
            throw AccountSessionError.signedOut
        }
    }

    private var tokenIsNearExpiry: Bool {
        guard let accessTokenExpiry else { return true }
        return accessTokenExpiry.timeIntervalSinceNow < 300
    }

    private func restoreFromKeychain() {
        guard let storedAccessToken = KeychainStore.get(.accessToken),
              let email = KeychainStore.get(.email)
        else { return }
        accessToken = storedAccessToken
        refreshToken = KeychainStore.get(.refreshToken)
        if let expiryStr = KeychainStore.get(.expiry), let interval = TimeInterval(expiryStr) {
            accessTokenExpiry = Date(timeIntervalSinceReferenceDate: interval)
        }
        let identity = AccountIdentity(
            id: KeychainStore.get(.accountID),
            email: email,
            name: KeychainStore.get(.name),
            // Re-validated on the way out of the keychain so a stored value
            // is never trusted past the same host policy userinfo applies.
            pictureURL: AccountIdentity.pictureURL(fromWire: KeychainStore.get(.pictureURL))
        )
        state = .signedIn(identity)
        let gen = generation
        Task { [weak self] in
            guard let self else { return }
            await self.resolveRestoredIdentity(generation: gen)
        }
    }

    /// Re-resolves the identity from userinfo on every restore — refreshing
    /// the token first when it is near expiry — so a field the keychain never
    /// held (a photo added since the sign-in that stored it) arrives without
    /// waiting for the token to age.
    private func resolveRestoredIdentity(generation: Int) async {
        do {
            let token: String
            if tokenIsNearExpiry {
                token = try await refreshStoredTokens().accessToken
            } else if let accessToken {
                token = accessToken
            } else {
                return
            }
            guard self.generation == generation else { return }
            let identity = try await resolvedIdentity(accessToken: token)
            guard self.generation == generation else { return }
            storeIdentity(identity)
            state = .signedIn(identity)
        } catch {
            // A rejected refresh has already signed out inside performRefresh;
            // anything else is transient (network error, rate limit, etc.) and
            // the stored identity still stands.
        }
    }

    /// Fetches userinfo, refreshing once on 401 (mirrors the desktop 401 → refresh → retry).
    private func resolvedIdentity(accessToken: String) async throws -> AccountIdentity {
        do {
            return try await client.userInfo(accessToken: accessToken)
        } catch AccountClientError.serverError(let status, _) where status == 401 {
            let refreshed = try await refreshStoredTokens()
            return try await client.userInfo(accessToken: refreshed.accessToken)
        }
    }

    private func storeTokens(_ tokens: AccountTokens) {
        accessToken = tokens.accessToken
        refreshToken = tokens.refreshToken
        accessTokenExpiry = tokens.expiry
        let persisted = [
            KeychainStore.set(tokens.accessToken, for: .accessToken),
            KeychainStore.set(tokens.refreshToken, for: .refreshToken),
            KeychainStore.set(String(tokens.expiry.timeIntervalSinceReferenceDate), for: .expiry),
        ]
        credentialsPersisted = persisted.allSatisfy { $0 }
    }

    private func storeIdentity(_ identity: AccountIdentity) {
        // The email gates restore like the tokens do; the id, name, and
        // picture are cosmetic, so their persistence does not decide the flag.
        let emailPersisted = KeychainStore.set(identity.email, for: .email)
        credentialsPersisted = credentialsPersisted && emailPersisted
        if let id = identity.id { KeychainStore.set(id, for: .accountID) }
        if let name = identity.name { KeychainStore.set(name, for: .name) }
        // Deleted when absent so a photo removed at the provider does not
        // outlive the provider's own answer.
        if let picture = identity.pictureURL {
            KeychainStore.set(picture.absoluteString, for: .pictureURL)
        } else {
            KeychainStore.delete(.pictureURL)
        }
    }
}

extension AccountSession: AccountTokenProviding {
    public var accountEmail: String? {
        guard case .signedIn(let identity) = state else { return nil }
        return identity.email
    }
}
