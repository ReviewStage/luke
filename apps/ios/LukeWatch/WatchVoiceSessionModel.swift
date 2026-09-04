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
///
/// The session is not minted until the developer presses the talk button
/// (beginTurn). prepare(accountSession:) is called on view appear to store the
/// credential reference without opening any connection.
@Observable
@MainActor
final class WatchVoiceSessionModel {
    var messages: [WatchVoiceMessage] = []
    var status: RealtimeStatus = .idle
    var errorMessage: String?

    private var accountSession: WatchAccountSession?
    private var session: RealtimeSession?
    private var connectingForTurn = false
    private var endTurnAfterConnect = false
    private var connectTask: Task<Void, Never>?
    // Tracks whether we are mid-caption-segment for the current luke reply.
    // nil from onCaption closes the segment so the next text starts a new bubble.
    private var lukeReplyOpen = false

    func prepare(accountSession: WatchAccountSession) {
        self.accountSession = accountSession
    }

    private func connect(startWithTurn: Bool) async {
        guard session == nil, let accountSession else { return }
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
                // An idle timeout releases the socket so the next button press
                // remints rather than sending on a stale connection.
                if newStatus == .idle { self?.session = nil }
            },
            onCaption: { [weak self] text in
                guard let self else { return }
                if let text {
                    // Mid-segment: grow the current luke bubble.
                    // New segment (lukeReplyOpen == false): always append a fresh bubble
                    // so a multi-segment reply does not overwrite its own earlier segments.
                    if self.lukeReplyOpen,
                       let lastIndex = self.messages.indices.last,
                       self.messages[lastIndex].speaker == .luke
                    {
                        self.messages[lastIndex].text = text
                    } else {
                        self.messages.append(WatchVoiceMessage(speaker: .luke, text: text))
                        self.lukeReplyOpen = true
                    }
                } else {
                    // nil signals segment end — the next caption begins a new bubble.
                    self.lukeReplyOpen = false
                }
            },
            onSpokenAsk: { [weak self] text in
                // A new developer turn always closes the current luke segment.
                self?.lukeReplyOpen = false
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
        let s = RealtimeSession(options: opts)
        session = s
        await s.connect(startWithTurn: startWithTurn)
    }

    func stop() {
        connectTask?.cancel()
        connectTask = nil
        connectingForTurn = false
        endTurnAfterConnect = false
        lukeReplyOpen = false
        accountSession = nil
        session?.close()
        session = nil
    }

    func beginTurn() {
        errorMessage = nil
        if let session {
            session.beginTurn()
            return
        }
        if connectingForTurn {
            // A re-press while the mint is in flight retracts the earlier release
            // so the turn is not immediately ended when the connection lands.
            endTurnAfterConnect = false
            return
        }
        // No existing session: mint a new one and begin the turn once connected.
        guard accountSession != nil else { return }
        connectingForTurn = true
        endTurnAfterConnect = false
        status = .connecting
        connectTask = Task { [weak self] in
            await self?.connect(startWithTurn: true)
            guard let self, !Task.isCancelled, self.connectingForTurn else { return }
            self.connectingForTurn = false
            self.connectTask = nil
            if self.endTurnAfterConnect {
                self.endTurnAfterConnect = false
                self.session?.endTurn()
            }
        }
    }

    func endTurn() {
        if connectingForTurn {
            endTurnAfterConnect = true
            session?.endTurn()
        } else {
            session?.endTurn()
        }
    }
}
