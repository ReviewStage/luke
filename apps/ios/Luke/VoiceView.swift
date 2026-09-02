import LukeKit
import Observation
import SwiftUI

// MARK: - Observable session state

private struct VoiceTranscriptMessage: Identifiable, Equatable {
    enum Speaker: Equatable {
        case developer
        case luke
    }

    let id = UUID()
    let turnId: UUID
    let speaker: Speaker
    var words: String
}

/// Holds all observable voice session state. Lives on the main actor so the
/// session's @MainActor callbacks can update it without hopping actors.
@Observable
@MainActor
private final class VoiceSessionModel {
    var status: RealtimeStatus = .idle
    var messages: [VoiceTranscriptMessage] = []
    var errorMessage: String?
    private var session: RealtimeSession?
    private var activeTurnId: UUID?
    private var activeResponseMessageId: UUID?
    // Cleared by stop() before close() so an explicit stop does not trigger
    // an auto-reconnect through the onStatus(.idle) path.
    private var reconnectCallback: (@MainActor () async -> Void)?

    func start(accountSession: AccountSession) async {
        guard session == nil else { return }
        errorMessage = nil

        let opts = RealtimeSessionOptions(
            requestConnection: { [weak accountSession] in
                guard let accountSession else {
                    throw AccountSessionError.signedOut
                }
                let token = try await accountSession.validAccessToken()
                let connection = try await VoiceMintClient(baseURL: AccountConstants.serviceURL)
                    .mint(accessToken: token)
                return connection
            },
            onStatus: { [weak self] newStatus in
                self?.status = newStatus
                // Clear the session reference when it goes idle so start() can
                // reconnect. If reconnectCallback is set (not a stop() path),
                // automatically restart so the button becomes live again.
                if newStatus == .idle {
                    self?.session = nil
                    if let reconnect = self?.reconnectCallback {
                        Task { await reconnect() }
                    }
                }
            },
            onCaption: { [weak self] text in self?.receiveCaption(text) },
            onSpokenAsk: { [weak self] text in self?.receiveSpokenAsk(text) },
            onError: { [weak self] message in
                // Stop auto-reconnect on errors — a quota failure or auth error
                // would loop forever if we let onStatus(.idle) trigger a retry.
                self?.reconnectCallback = nil
                self?.errorMessage = message ?? "Connection error"
            },
            onRecoverableError: { [weak self] message in
                self?.errorMessage = message
            },
            dispatchToolCall: { [weak accountSession] name, arguments, callId in
                let token = (try? await accountSession?.validAccessToken()) ?? ""
                return await dispatchVoiceToolCall(
                    name: name,
                    arguments: arguments,
                    callId: callId,
                    accessToken: token,
                    serviceURL: AccountConstants.serviceURL
                )
            },
            makeAudioCapturer: { VoiceAudioCapturer() },
            makeAudioPlayer: { VoiceAudioPlayer() }
        )
        reconnectCallback = { [weak self, weak accountSession] in
            guard let accountSession else { return }
            await self?.start(accountSession: accountSession)
        }
        let s = RealtimeSession(options: opts)
        session = s
        await s.connect()
    }

    func stop() {
        // Nil the callback before close() so the .idle status change triggered
        // by close() does not schedule a reconnect on an explicit stop.
        reconnectCallback = nil
        session?.close()
        session = nil
    }

    func beginTurn() {
        errorMessage = nil
        activeTurnId = UUID()
        activeResponseMessageId = nil
        session?.beginTurn()
    }
    func endTurn() { session?.endTurn() }

    private func receiveSpokenAsk(_ text: String) {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        let turnId = currentTurnId()
        if let index = messages.firstIndex(where: {
            $0.turnId == turnId && $0.speaker == .developer
        }) {
            messages[index].words = words
            return
        }
        let message = VoiceTranscriptMessage(turnId: turnId, speaker: .developer, words: words)
        if let responseIndex = messages.firstIndex(where: {
            $0.turnId == turnId && $0.speaker == .luke
        }) {
            messages.insert(message, at: responseIndex)
        } else {
            messages.append(message)
        }
    }

    private func receiveCaption(_ text: String?) {
        guard let text, !text.isEmpty else {
            activeResponseMessageId = nil
            return
        }
        if let id = activeResponseMessageId,
           let index = messages.firstIndex(where: { $0.id == id })
        {
            messages[index].words = text
            return
        }
        let message = VoiceTranscriptMessage(
            turnId: currentTurnId(),
            speaker: .luke,
            words: text
        )
        messages.append(message)
        activeResponseMessageId = message.id
    }

    private func currentTurnId() -> UUID {
        if let activeTurnId { return activeTurnId }
        let id = UUID()
        activeTurnId = id
        return id
    }
}

// MARK: - VoiceView

/// Push-to-talk voice conversation with Luke. Hold the button to speak;
/// release to send; Luke responds with audio and a running caption.
struct VoiceView: View {
    @Environment(AccountSession.self) private var accountSession
    @State private var model = VoiceSessionModel()
    @State private var isPressing = false

    var body: some View {
        ZStack {
            Color(red: 0.09, green: 0.09, blue: 0.10).ignoresSafeArea()
            VStack(spacing: 24) {
                statusLabel
                conversationHistory
                talkButton
                if let error = model.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(Color(red: 0.95, green: 0.4, blue: 0.4))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
        }
        .preferredColorScheme(.dark)
        .task { await model.start(accountSession: accountSession) }
        .onDisappear { model.stop() }
    }

    // MARK: - Sub-views

    private var statusLabel: some View {
        Text(statusText)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(Color(white: 1, opacity: 0.5))
            .animation(.easeInOut(duration: 0.2), value: model.status)
    }

    private var conversationHistory: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(red: 0.12, green: 0.12, blue: 0.13))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color(white: 1, opacity: 0.08), lineWidth: 1)
                )
            if model.messages.isEmpty {
                Text(placeholderText)
                    .font(.system(size: 17))
                    .foregroundStyle(Color(white: 1, opacity: 0.25))
                    .multilineTextAlignment(.center)
                    .padding(20)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 14) {
                            ForEach(model.messages) { message in
                                switch message.speaker {
                                case .developer:
                                    DeveloperMessageBubble(words: message.words)
                                case .luke:
                                    AgentMessageBubble(words: message.words)
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                        .padding(16)
                    }
                    .onChange(of: model.messages) {
                        guard let last = model.messages.last else { return }
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
        .frame(minHeight: 160)
        .frame(maxHeight: .infinity)
        .animation(.easeInOut(duration: 0.15), value: model.messages.isEmpty)
    }

    private var talkButton: some View {
        // Keep the view enabled while the user is actively pressing — disabling
        // during .listening would cancel the in-flight DragGesture and fire
        // onEnded immediately, collapsing every hold into an instant tap.
        let canTalk = model.status == .ready || model.status == .connecting || isPressing
        return Circle()
            .fill(talkButtonColor)
            .overlay(
                Image(systemName: isPressing ? "waveform" : "mic.fill")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(Color.white)
            )
            .frame(width: 80, height: 80)
            .scaleEffect(isPressing ? 1.12 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: isPressing)
            .opacity(canTalk ? 1 : 0.4)
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !isPressing else { return }
                        isPressing = true
                        model.beginTurn()
                    }
                    .onEnded { _ in
                        isPressing = false
                        model.endTurn()
                    }
            )
            .disabled(!canTalk)
    }

    // MARK: - Helpers

    private var talkButtonColor: Color {
        if isPressing { return Color(red: 0.25, green: 0.55, blue: 1.0) }
        switch model.status {
        case .thinking: return Color(red: 0.9, green: 0.7, blue: 0.2)
        case .speaking: return Color(red: 0.2, green: 0.8, blue: 0.5)
        default: return Color(red: 0.18, green: 0.18, blue: 0.20)
        }
    }

    private var statusText: String {
        switch model.status {
        case .idle: return model.errorMessage != nil ? "Connection failed" : "Connecting…"
        case .connecting: return "Connecting…"
        case .ready: return "Hold to talk"
        case .listening: return "Listening…"
        case .thinking: return "Thinking…"
        case .speaking: return "Speaking…"
        }
    }

    private var placeholderText: String {
        model.status == .ready ? "Hold the button and speak." : ""
    }
}
