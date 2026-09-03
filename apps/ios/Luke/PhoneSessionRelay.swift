import LukeKit
import WatchConnectivity

/// Sends the signed-in account's tokens to the paired Apple Watch via
/// WatchConnectivity, and responds to on-demand token requests from the watch.
///
/// Tokens are pushed proactively on sign-in and after each refresh, and the
/// watch can request them at any time via a `requestTokens` message.
final class PhoneSessionRelay: NSObject, WCSessionDelegate {
    private let accountSession: AccountSession

    init(accountSession: AccountSession) {
        self.accountSession = accountSession
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Pushes current tokens to the watch. Called after sign-in and after
    /// token refresh so the watch never works with a stale refresh token.
    @MainActor
    func push() {
        let s = WCSession.default
        print("[PhoneRelay] push — state:\(s.activationState.rawValue) paired:\(s.isPaired) watchInstalled:\(s.isWatchAppInstalled) reachable:\(s.isReachable) signedIn:\(accountSession.tokenPayload() != nil)")
        guard s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else { return }
        guard let payload = accountSession.tokenPayload() else { return }
        s.transferUserInfo(payload)
        print("[PhoneRelay] transferUserInfo sent")
    }

    /// Notifies the watch that the user signed out on the phone.
    @MainActor
    func pushSignOut() {
        guard WCSession.default.activationState == .activated,
              WCSession.default.isPaired,
              WCSession.default.isWatchAppInstalled
        else { return }
        WCSession.default.transferUserInfo(["event": "signedOut"])
    }

    // MARK: WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: (any Error)?
    ) {
        guard activationState == .activated else { return }
        Task { @MainActor [weak self] in self?.push() }
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

    func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        Task { @MainActor [weak self] in self?.push() }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
}
