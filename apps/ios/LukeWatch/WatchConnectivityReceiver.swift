import WatchConnectivity

/// Activates WatchConnectivity on the watch, requests tokens from the paired
/// iPhone on first launch, and feeds every inbound payload to WatchAccountSession.
final class WatchConnectivityReceiver: NSObject, WCSessionDelegate {
    private let watchSession: WatchAccountSession

    init(watchSession: WatchAccountSession) {
        self.watchSession = watchSession
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // MARK: WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: (any Error)?
    ) {
        guard activationState == .activated else { return }
        requestTokensIfNeeded()
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        requestTokensIfNeeded()
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        Task { @MainActor [weak self] in self?.watchSession.receive(payload: userInfo) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor [weak self] in self?.watchSession.receive(payload: message) }
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        Task { @MainActor [weak self] in self?.watchSession.receive(payload: message) }
        replyHandler([:])
    }

    // MARK: - Private

    private func requestTokensIfNeeded() {
        Task { @MainActor [weak self] in
            guard let self, case .signedOut = watchSession.state else { return }
            guard WCSession.default.isReachable else { return }
            WCSession.default.sendMessage(
                ["event": "requestTokens"],
                replyHandler: { [weak self] reply in
                    Task { @MainActor [weak self] in self?.watchSession.receive(payload: reply) }
                },
                errorHandler: nil
            )
        }
    }
}
