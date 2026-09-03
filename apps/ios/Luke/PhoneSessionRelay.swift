import LukeKit
import WatchConnectivity

/// Sends the signed-in account's tokens to the paired Apple Watch via
/// WatchConnectivity, and responds to on-demand token requests from the watch.
///
/// Tokens are pushed proactively on sign-in, after each token rotation, and
/// when the WatchConnectivity session becomes reachable or the watch state
/// changes, so the watch never works with a stale refresh token.
final class PhoneSessionRelay: NSObject, WCSessionDelegate {
    private let accountSession: AccountSession

    init(accountSession: AccountSession) {
        self.accountSession = accountSession
        super.init()
        accountSession.onTokensRefreshed = { [weak self] in
            Task { @MainActor [weak self] in self?.push() }
        }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Pushes current tokens to the watch. Called after sign-in, after token
    /// rotation, and when the WatchConnectivity session becomes active/reachable.
    @MainActor
    func push() {
        let s = WCSession.default
        // isWatchAppInstalled is unreliable in the simulator; isPaired is the
        // meaningful gate. transferUserInfo queues the delivery gracefully.
        guard s.activationState == .activated, s.isPaired else { return }
        guard let payload = accountSession.tokenPayload() else { return }
        s.transferUserInfo(payload)
    }

    /// Notifies the watch that the user signed out on the phone.
    @MainActor
    func pushSignOut() {
        let s = WCSession.default
        guard s.activationState == .activated, s.isPaired else { return }
        s.transferUserInfo(["event": "signedOut"])
    }

    // MARK: WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: (any Error)?
    ) {
        guard activationState == .activated else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            if accountSession.tokenPayload() != nil {
                push()
            } else {
                pushSignOut()
            }
        }
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        guard message["event"] as? String == "requestTokens" else {
            replyHandler([:])
            return
        }
        Task { @MainActor [weak self] in
            replyHandler(self?.accountSession.tokenPayload() ?? [:])
        }
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor [weak self] in self?.push() }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        Task { @MainActor [weak self] in self?.push() }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
