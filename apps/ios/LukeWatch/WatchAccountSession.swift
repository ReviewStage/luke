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
    private var tokenExpiry: Date?

    init() {
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
        self.tokenExpiry = stored.expiry
        state = .signedIn(email: email, name: stored.name)
    }

    func signOut() {
        accessToken = nil
        tokenExpiry = nil
        WatchTokenStore.clear()
        state = .signedOut
    }

    /// Returns the stored access token when it is still valid.
    ///
    /// The watch never refreshes tokens independently — doing so would spend
    /// the rotating refresh token the phone holds, invalidating the phone's
    /// own session. When the stored token is near expiry the watch throws
    /// `.signedOut` and waits for the phone to push a fresh pair via
    /// WatchConnectivity, which it does after every token rotation.
    func validAccessToken() async throws -> String {
        guard case .signedIn = state, let accessToken else {
            throw AccountSessionError.signedOut
        }
        guard !tokenNearExpiry else {
            signOut()
            throw AccountSessionError.signedOut
        }
        return accessToken
    }

    // MARK: - Private

    private var tokenNearExpiry: Bool {
        guard let tokenExpiry else { return true }
        return tokenExpiry.timeIntervalSinceNow < 300
    }

    private func restoreFromKeychain() {
        guard let stored = WatchTokenStore.load() else { return }
        accessToken = stored.accessToken
        tokenExpiry = stored.expiry
        state = .signedIn(email: stored.email, name: stored.name)
    }

    private func nonEmpty(_ value: String?) -> String? {
        value.flatMap { $0.isEmpty ? nil : $0 }
    }
}

// MARK: - AccountTokenProviding

extension WatchAccountSession: AccountTokenProviding {
    var accountEmail: String? {
        guard case .signedIn(let email, _) = state else { return nil }
        return email
    }

    /// The watch never refreshes tokens independently — spending the phone's
    /// rotating refresh token would invalidate the phone's own session. A near-
    /// expiry token is surfaced as `.signedOut` so the caller waits for the phone
    /// to push a fresh pair rather than attempting a refresh.
    func refreshAccessToken() async throws -> String {
        signOut()
        throw AccountSessionError.signedOut
    }
}
