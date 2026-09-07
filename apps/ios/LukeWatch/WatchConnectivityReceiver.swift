import LukeKit
import WatchConnectivity

/// Activates WatchConnectivity on the watch, requests tokens from the paired
/// iPhone on first launch, feeds every inbound payload to WatchAccountSession,
/// and keeps this watch's device settings and the phone's equal through the
/// session's application context: the phone's latest snapshot is applied as
/// it arrives, and a change made on the wrist is sent back the same way.
final class WatchConnectivityReceiver: NSObject, WCSessionDelegate {
    private let watchSession: WatchAccountSession
    private let settings: DeviceSettingsSync

    @MainActor
    init(watchSession: WatchAccountSession) {
        self.watchSession = watchSession
        settings = DeviceSettingsSync(publish: Self.publishSettings)
        super.init()
        settings.start()
        watchSession.onCredentialsNeeded = { [weak self] in
            self?.requestTokensIfNeeded()
        }
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
        let received = session.receivedApplicationContext
        Task { @MainActor [weak self] in
            self?.settings.receive(received)
            self?.settings.publishCurrent()
        }
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

    func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        Task { @MainActor [weak self] in self?.settings.receive(context) }
    }

    // MARK: - Private

    private static func publishSettings(_ payload: [String: Any]) {
        let s = WCSession.default
        guard s.activationState == .activated else { return }
        try? s.updateApplicationContext(payload)
    }

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
