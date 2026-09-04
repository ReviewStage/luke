import Foundation
import LukeKit
import Observation

struct WatchVoiceMessage: Identifiable {
    enum Speaker { case user, luke }
    let id = UUID()
    let speaker: Speaker
    var text: String
}

/// Observable session state for the watch voice screen. Drives one RealtimeSession
/// with a tool-free configuration — the watch carries no armed-act infrastructure,
/// so dispatchToolCall always refuses and contextItems is always empty.
@Observable
@MainActor
final class WatchVoiceSessionModel {
    var messages: [WatchVoiceMessage] = []
    var status: RealtimeStatus = .idle
    var errorMessage: String?

    private var session: RealtimeSession?
    private var reconnectCallback: (@MainActor (_ startWithTurn: Bool) async -> Void)?
    private var reconnectTurnTask: Task<Void, Never>?
    private var reconnectingForTurn = false
    private var endTurnAfterReconnect = false

    func start(accountSession: WatchAccountSession, startWithTurn: Bool = false) async {
        guard session == nil else { return }
        errorMessage = nil

        let opts = RealtimeSessionOptions(
            requestConnection: { [weak accountSession] in
                guard let accountSession else { throw AccountSessionError.signedOut }
                let token = try await accountSession.validAccessToken()
                return try await VoiceMintClient(baseURL: AccountConstants.serviceURL)
                    .mint(
                        accessToken: token,
                        voice: RealtimeVoice.default.rawValue,
                        speed: RealtimeVoiceSpeed.default.multiplier
                    )
            },
            onStatus: { [weak self] newStatus in
                self?.status = newStatus
                if newStatus == .idle { self?.session = nil }
            },
            onCaption: { [weak self] text in
                guard let self, let text else { return }
                if let lastIndex = self.messages.indices.last,
                   self.messages[lastIndex].speaker == .luke
                {
                    self.messages[lastIndex].text = text
                } else {
                    self.messages.append(WatchVoiceMessage(speaker: .luke, text: text))
                }
            },
            onSpokenAsk: { [weak self] text in
                self?.messages.append(WatchVoiceMessage(speaker: .user, text: text))
            },
            onError: { [weak self, weak accountSession] message in
                guard let self else { return }
                // Surface a credential failure as an actionable prompt rather
                // than a generic error: the watch can't refresh tokens itself.
                if accountSession?.state == .signedOut {
                    self.errorMessage = "Open Luke on your iPhone"
                } else {
                    self.errorMessage = message ?? "Connection error"
                }
            },
            onRecoverableError: { [weak self] message in self?.errorMessage = message },
            onSessionTools: { _ in },
            dispatchToolCall: { _, _, _ in
                // The watch carries no armed-act infrastructure. Tool calls are
                // refused here rather than implementing a partial gate.
                #"{"error":"not authorized"}"#
            },
            contextItems: { [] },
            makeAudioCapturer: { WatchAudioCapturer() },
            makeAudioPlayer: { WatchAudioPlayer() }
        )
        reconnectCallback = { [weak self, weak accountSession] startWithTurn in
            guard let accountSession else { return }
            await self?.start(accountSession: accountSession, startWithTurn: startWithTurn)
        }
        let s = RealtimeSession(options: opts)
        session = s
        await s.connect(startWithTurn: startWithTurn)
    }

    func stop() {
        reconnectTurnTask?.cancel()
        reconnectTurnTask = nil
        reconnectingForTurn = false
        endTurnAfterReconnect = false
        reconnectCallback = nil
        session?.close()
        session = nil
    }

    func beginTurn() {
        errorMessage = nil
        if let session {
            session.beginTurn()
            return
        }
        guard let reconnect = reconnectCallback, !reconnectingForTurn else { return }
        reconnectingForTurn = true
        endTurnAfterReconnect = false
        status = .connecting
        reconnectTurnTask = Task { [weak self] in
            await reconnect(true)
            guard let self, !Task.isCancelled, self.reconnectingForTurn else { return }
            self.reconnectingForTurn = false
            self.reconnectTurnTask = nil
            if self.endTurnAfterReconnect {
                self.endTurnAfterReconnect = false
                self.session?.endTurn()
            }
        }
    }

    func endTurn() {
        if reconnectingForTurn {
            endTurnAfterReconnect = true
            session?.endTurn()
        } else {
            session?.endTurn()
        }
    }
}
