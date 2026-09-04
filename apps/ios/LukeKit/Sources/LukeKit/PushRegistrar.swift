import Foundation
import Observation

/// Keeps the service's record of this phone true to who is signed in on it.
/// Apple hands the app a token on its own schedule and the account signs in
/// and out on the developer's, so the registrar holds whichever arrived
/// first and registers the moment both stand: a token under a signed-in
/// account. A sign-out unregisters under the account that is leaving, before
/// its bearer is gone, and the token stays held for the next sign-in, which
/// moves it to the new account in the same registration.
@MainActor
@Observable
public final class PushRegistrar {
    public struct HeldToken: Equatable, Sendable {
        public let token: String
        public let environment: PushEnvironment

        public init(token: String, environment: PushEnvironment) {
            self.token = token
            self.environment = environment
        }
    }

    /// The token Apple issued this installation, once it has.
    public private(set) var held: HeldToken?
    /// The account the held token is registered under on the service, or nil.
    public private(set) var registeredAccount: String?
    public private(set) var lastError: String?

    private let client: DeviceClient
    private let session: any AccountTokenProviding

    public init(client: DeviceClient, session: any AccountTokenProviding) {
        self.client = client
        self.session = session
    }

    /// Apple issued or re-issued the token. Registered at once under the
    /// signed-in account, if there is one; held for the sign-in otherwise.
    public func tokenArrived(_ token: String, environment: PushEnvironment) async {
        let arrived = HeldToken(token: token, environment: environment)
        if held != arrived { registeredAccount = nil }
        held = arrived
        await registerIfReady()
    }

    /// The account signed in, or was already signed in at launch: the held
    /// token, if any, is registered under it.
    public func accountSignedIn() async {
        await registerIfReady()
    }

    /// Forgets the phone on the service under the account about to leave.
    /// Must run before the sign-out clears the bearer, since the delete is
    /// scoped to the account that holds the row. The token stays held.
    public func unregister() async {
        guard let held, let account = session.accountEmail else { return }
        do {
            _ = try await session.authorized { token in
                try await self.client.unregister(token: held.token, accessToken: token)
            }
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
        if registeredAccount == account { registeredAccount = nil }
    }

    private func registerIfReady() async {
        guard let held, let account = session.accountEmail else { return }
        guard registeredAccount != account else { return }
        do {
            try await session.authorized { token in
                try await self.client.register(
                    token: held.token, environment: held.environment, accessToken: token
                )
            }
            // The account may have changed hands while the call traveled; the
            // registration is the asking account's alone.
            guard session.accountEmail == account, self.held == held else { return }
            registeredAccount = account
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }
}
