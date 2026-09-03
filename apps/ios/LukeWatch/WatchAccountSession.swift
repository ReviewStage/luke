import Foundation
import LukeKit
import Observation

/// Auth state for the watch app, populated by credentials received from the
/// paired iPhone via WatchConnectivity. No OAuth UI runs on the watch itself.
@MainActor
@Observable
final class WatchAccountSession {
    enum State: Equatable {
        case signedOut
        case signedIn(email: String, name: String?)

        static func == (lhs: State, rhs: State) -> Bool {
            switch (lhs, rhs) {
            case (.signedOut, .signedOut): true
            case let (.signedIn(e1, n1), .signedIn(e2, n2)): e1 == e2 && n1 == n2
            default: false
            }
        }
    }

    private(set) var state: State = .signedOut

    private var accessToken: String?
    private var refreshToken: String?
    private var tokenExpiry: Date?
    private var refreshInFlight: Task<String, Error>?
    private var generation = 0

    // AccountClient is reused from LukeKit — the token endpoint is the same
    // as on the phone and works identically from watchOS.
    let client: AccountClient

    init(client: AccountClient) {
        self.client = client
        restoreFromKeychain()
    }

    /// Applies a payload delivered by WatchConnectivity from the phone.
    /// Accepts both proactive pushes and sign-out notifications.
    func receive(payload: [String: Any]) {
        if payload["event"] as? String == "signedOut" {
            signOut()
            return
        }
        guard
            let accessToken = payload["access_token"] as? String,
            let refreshToken = payload["refresh_token"] as? String,
            let expiryInterval = payload["token_expiry"] as? Double,
            let email = payload["email"] as? String
        else { return }

        let stored = WatchTokenStore.Tokens(
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiry: Date(timeIntervalSinceReferenceDate: expiryInterval),
            email: email,
            name: nonEmpty(payload["name"] as? String),
            accountID: nonEmpty(payload["account_id"] as? String),
            pictureURL: nonEmpty(payload["picture_url"] as? String)
        )
        WatchTokenStore.save(stored)
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.tokenExpiry = stored.expiry
        state = .signedIn(email: email, name: stored.name)
    }

    func signOut() {
        generation += 1
        accessToken = nil
        refreshToken = nil
        tokenExpiry = nil
        refreshInFlight = nil
        WatchTokenStore.clear()
        state = .signedOut
    }

    /// Returns a valid access token, refreshing first when near expiry.
    /// Concurrent callers coalesce onto the same in-flight refresh, mirroring
    /// the phone's AccountSession discipline.
    func validAccessToken() async throws -> String {
        guard case .signedIn = state, let accessToken else {
            throw AccountSessionError.signedOut
        }
        guard tokenNearExpiry else { return accessToken }
        return try await coalesceRefresh()
    }

    // MARK: - Private

    private var tokenNearExpiry: Bool {
        guard let tokenExpiry else { return true }
        return tokenExpiry.timeIntervalSinceNow < 300
    }

    private func coalesceRefresh() async throws -> String {
        if let inflight = refreshInFlight { return try await inflight.value }
        let task = Task<String, Error> {
            defer { self.refreshInFlight = nil }
            return try await self.performRefresh()
        }
        refreshInFlight = task
        return try await task.value
    }

    private func performRefresh() async throws -> String {
        guard let refreshToken else { throw AccountSessionError.signedOut }
        let gen = generation
        do {
            let tokens = try await client.refresh(refreshToken: refreshToken)
            guard generation == gen else { throw AccountSessionError.signedOut }
            if var stored = WatchTokenStore.load() {
                stored.accessToken = tokens.accessToken
                stored.refreshToken = tokens.refreshToken
                stored.expiry = tokens.expiry
                WatchTokenStore.save(stored)
            }
            self.accessToken = tokens.accessToken
            self.refreshToken = tokens.refreshToken
            self.tokenExpiry = tokens.expiry
            return tokens.accessToken
        } catch AccountClientError.serverError(_, let oauthError) where oauthError == "invalid_grant" {
            if generation == gen { signOut() }
            throw AccountSessionError.signedOut
        }
    }

    private func restoreFromKeychain() {
        guard let stored = WatchTokenStore.load() else { return }
        accessToken = stored.accessToken
        refreshToken = stored.refreshToken
        tokenExpiry = stored.expiry
        state = .signedIn(email: stored.email, name: stored.name)
    }

    private func nonEmpty(_ value: String?) -> String? {
        value.flatMap { $0.isEmpty ? nil : $0 }
    }
}
