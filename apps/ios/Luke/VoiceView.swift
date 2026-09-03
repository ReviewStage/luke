import Foundation
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

/// Where a spoken act asked to take the developer once Luke has finished
/// saying so: a session's own screen, or the list narrowed as asked. Held
/// until the reply settles, because moving the screen mid-sentence would
/// close the call that is still speaking.
private enum PendingNavigation {
    case open(RosterSession)
    case list(VoiceAsks.SessionListAsk)
}

/// Holds all observable voice session state. Lives on the main actor so the
/// session's @MainActor callbacks can update it without hopping actors.
@Observable
@MainActor
private final class VoiceSessionModel {
    var status: RealtimeStatus = .idle
    var messages: [VoiceTranscriptMessage] = []
    var errorMessage: String?
    // Read at each start, so a reconnect mints with the latest choice.
    var voice = RealtimeVoice.default
    var speed = RealtimeVoiceSpeed.default
    var pendingNavigation: PendingNavigation?
    /// The tools the service minted the latest call with, as the server
    /// confirmed them at channel open; nil until a call has connected.
    private(set) var mintedTools: [String]?
    /// Where a workspace can be created, fetched beside the mint so the
    /// conversation is told it at channel open and a creation ask can be
    /// validated against it. Nil until an answer lands, and left nil when
    /// the fetch fails, so the conversation is told nothing rather than
    /// told there is nowhere.
    private(set) var projects: ProjectsAnswer?
    /// The New Workspace choices this device remembers, read at the moment a
    /// call opens or an act lands.
    let defaults = WorkspaceCreationDefaults()
    private var session: RealtimeSession?
    private var makeActContext: (@MainActor () -> VoiceActContext)?
    private var activeTurnId: UUID?
    private var activeResponseMessageId: UUID?
    // Kept while this screen is alive so a direct press can reopen a socket
    // after the three-minute idle close. An idle edge itself never remints.
    private var reconnectCallback: (@MainActor (_ startWithTurn: Bool) async -> Void)?
    private var reconnectTurnTask: Task<Void, Never>?
    private var reconnectingForTurn = false
    private var endTurnAfterReconnect = false

    func start(
        accountSession: AccountSession,
        actContext: @escaping @MainActor () -> VoiceActContext,
        startWithTurn: Bool = false
    ) async {
        guard session == nil else { return }
        errorMessage = nil
        makeActContext = actContext

        let mintVoice = voice.rawValue
        let mintSpeed = speed.multiplier
        let opts = RealtimeSessionOptions(
            requestConnection: { [weak accountSession, weak self] in
                guard let accountSession else {
                    throw AccountSessionError.signedOut
                }
                let token = try await accountSession.validAccessToken()
                // Fetched beside the mint rather than after it: the projects
                // item is sent at channel open, and the ephemeral key's
                // minute is not to be spent waiting on a second round trip.
                async let projects = try? ProjectsClient(serviceURL: AccountConstants.serviceURL)
                    .projects(bearerToken: token)
                let connection = try await VoiceMintClient(baseURL: AccountConstants.serviceURL)
                    .mint(accessToken: token, voice: mintVoice, speed: mintSpeed)
                if let answer = await projects {
                    await MainActor.run { [weak self] in self?.projects = answer }
                }
                return connection
            },
            onStatus: { [weak self] newStatus in
                self?.status = newStatus
                // An idle timeout releases the socket and quota until the
                // developer explicitly presses again.
                if newStatus == .idle {
                    self?.session = nil
                }
            },
            onCaption: { [weak self] text in self?.receiveCaption(text) },
            onSpokenAsk: { [weak self] text in self?.receiveSpokenAsk(text) },
            onError: { [weak self] message in
                self?.errorMessage = message ?? "Connection error"
            },
            onRecoverableError: { [weak self] message in
                self?.errorMessage = message
            },
            onSessionTools: { [weak self] names in self?.mintedTools = names },
            dispatchToolCall: { [weak self] name, arguments, _ in
                guard let self, let makeActContext = self.makeActContext else {
                    return #"{"error":"not authorized"}"#
                }
                return await dispatchVoiceToolCall(
                    name: name,
                    arguments: arguments,
                    context: makeActContext()
                )
            },
            contextItems: { [weak self] in
                guard let self, let projects = self.projects else { return [] }
                return [
                    WorkspaceProjectsContext.item(
                        answer: projects,
                        defaultProviderId: self.defaults.lastProviderId,
                        defaultProjectIds: self.defaults.lastProjectIds
                    )
                ]
            },
            makeAudioCapturer: { VoiceAudioCapturer() },
            makeAudioPlayer: { VoiceAudioPlayer() }
        )
        reconnectCallback = { [weak self, weak accountSession] startWithTurn in
            guard let accountSession else { return }
            await self?.start(
                accountSession: accountSession, actContext: actContext, startWithTurn: startWithTurn
            )
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
        // A new press supersedes what the last reply was about to do: an open
        // the developer talked over is an open they no longer want taken.
        pendingNavigation = nil
        activeTurnId = UUID()
        activeResponseMessageId = nil
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

    /// The voice is fixed at mint time, so an open connection is reopened.
    func changeVoice(_ newVoice: RealtimeVoice, accountSession: AccountSession) async {
        guard newVoice != voice else { return }
        voice = newVoice
        guard session != nil, let makeActContext else { return }
        stop()
        await start(accountSession: accountSession, actContext: makeActContext)
    }

    func changeSpeed(_ newSpeed: RealtimeVoiceSpeed) {
        guard newSpeed != speed else { return }
        speed = newSpeed
        session?.applySpeed(newSpeed.multiplier)
    }

    func endTurn() {
        if reconnectingForTurn {
            endTurnAfterReconnect = true
            // Once start() has installed the new session this stops capture
            // immediately, even while its mint request is still in flight.
            session?.endTurn()
        } else {
            session?.endTurn()
        }
    }

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

/// Voice conversation with Luke. Hold and release for push-to-talk, or tap
/// once to leave the microphone open and tap again to send.
struct VoiceView: View {
    @Environment(AccountSession.self) private var accountSession
    @AppStorage(VoiceSettingsKey.voice) private var voice = RealtimeVoice.default
    @AppStorage(VoiceSettingsKey.speed) private var speed = RealtimeVoiceSpeed.default
    @Environment(ProductEventSender.self) private var events
    @Environment(SessionsStore.self) private var store
    @State private var model = VoiceSessionModel()
    private let actClient = ActClient(baseURL: AccountConstants.serviceURL)
    @State private var isPressing = false
    @State private var isLatched = false
    @State private var pressBeganAt: TimeInterval?
    @State private var settingsShown = false

    var body: some View {
        ZStack {
            conversationHistory
            bottomControls
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.ground.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { settingsButton }
        }
        .sheet(isPresented: $settingsShown) {
            VoiceSettingsSheet(
                toolReport: VoiceToolAvailability.report(
                    mintedTools: model.mintedTools,
                    sessions: store.sessions,
                    projects: model.projects
                )
            )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .task {
            model.voice = voice
            model.speed = speed
            // The roster the acts are validated against is the list's own,
            // refreshed as the call opens so a session archived since the
            // list last drew is not offered as somewhere to act.
            async let roster: Void = store.refresh(account: accountSession, events: events)
            await model.start(accountSession: accountSession, actContext: makeActContext)
            await roster
        }
        .onChange(of: voice) { _, newVoice in
            Task { await model.changeVoice(newVoice, accountSession: accountSession) }
        }
        .onChange(of: speed) { _, newSpeed in model.changeSpeed(newSpeed) }
        .onChange(of: model.status) { _, newStatus in
            // Connecting is part of an idle tap's active turn. Clearing here
            // would make VoiceOver lose the second-tap-to-send affordance.
            if newStatus == .ready || newStatus == .idle {
                isLatched = false
                performPendingNavigation()
            }
        }
        .onDisappear { model.stop() }
    }

    /// What a tool call is carried against, read at the moment of the call.
    /// An open or a list ask is held for the reply to finish rather than
    /// performed at once: the screen moving mid-sentence would close the call
    /// still speaking the words that announce it.
    private func makeActContext() -> VoiceActContext {
        VoiceActContext(
            mintedTools: model.mintedTools,
            sessions: store.sessions,
            projects: model.projects,
            defaults: model.defaults,
            actClient: actClient,
            accessToken: { [accountSession] in try await accountSession.validAccessToken() },
            count: { [events] act, providerId in
                // A provider id the shared vocabulary has not answered for is
                // left uncounted rather than sent to be refused.
                guard let provider = ProductProviderID(rawValue: providerId) else { return }
                events.record(.sessionActSend(provider: provider, act: act))
            },
            refreshRoster: { [store, accountSession, events] in
                await store.refresh(account: accountSession, events: events)
            },
            // One screen, so the last open a reply names is the one taken.
            open: { [model] session in model.pendingNavigation = .open(session) },
            showList: { [model] ask in model.pendingNavigation = .list(ask) }
        )
    }

    /// Takes the developer where the settled reply said they were going. The
    /// voice screen leaves the stack either way, and this screen's
    /// `onDisappear` closes the call behind it.
    private func performPendingNavigation() {
        guard let pending = model.pendingNavigation else { return }
        model.pendingNavigation = nil
        switch pending {
        case .open(let session): store.openLeavingConversation(session)
        case .list(let ask): store.showList(ask)
        }
    }

    // MARK: - Sub-views

    private var settingsButton: some View {
        Button {
            settingsShown = true
        } label: {
            Label("Voice Settings", systemImage: "gearshape")
        }
        .tint(Color.ink)
    }

    private var statusLabel: some View {
        Text(statusText)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(Color.inkSecondary)
            .animation(.easeInOut(duration: 0.2), value: model.status)
    }

    private var conversationHistory: some View {
        ZStack {
            if model.messages.isEmpty {
                Text(placeholderText)
                    .font(.system(size: 17))
                    .foregroundStyle(Color.inkTertiary)
                    .multilineTextAlignment(.center)
                    .padding(20)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 14) {
                            ForEach(model.messages) { message in
                                Group {
                                    switch message.speaker {
                                    case .developer:
                                        DeveloperMessageBubble(words: message.words)
                                    case .luke:
                                        AgentMessageBubble(words: message.words)
                                    }
                                }
                                .id(message.id)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        // The controls float above the thread. Empty space at
                        // its tail lets the newest bubble clear them while the
                        // bubbles themselves can still scroll behind the glass.
                        .padding(.bottom, 160)
                    }
                    .onChange(of: model.messages) {
                        guard let last = model.messages.last else { return }
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                    .onAppear {
                        if let last = model.messages.last {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }
        }
        .frame(maxHeight: .infinity)
        .animation(.easeInOut(duration: 0.15), value: model.messages.isEmpty)
    }

    private var bottomControls: some View {
        VStack(spacing: 10) {
            Spacer()
            if let error = model.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Color.errorInk)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            talkButton
            statusLabel
        }
        .padding(.bottom, 10)
        .animation(.easeInOut(duration: 0.2), value: model.errorMessage)
    }

    @ViewBuilder
    private var talkButton: some View {
        // Keep the view enabled while the user is actively pressing — disabling
        // during .listening would cancel the in-flight DragGesture and fire
        // onEnded immediately, collapsing every hold into an instant tap.
        let canTalk = model.status == .ready
            || model.status == .idle
            || model.status == .connecting
            || model.status == .listening
            || model.status == .speaking
            || isPressing
        if #available(iOS 26.0, *) {
            Button(action: {}) { talkButtonLabel }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .tint(talkButtonColor)
                .simultaneousGesture(talkGesture)
                .disabled(!canTalk)
                .accessibilityLabel(isLatched ? "Tap to send" : "Talk to Luke")
                .accessibilityHint(
                    isLatched
                        ? "Stops listening and sends your message"
                        : "Tap to keep listening, or hold to talk"
                )
                .accessibilityAction { activateTalkButton() }
        } else {
            Button(action: {}) { talkButtonLabel }
                .buttonStyle(.plain)
                .background(talkButtonColor, in: Circle())
                .simultaneousGesture(talkGesture)
                .disabled(!canTalk)
                .accessibilityLabel(isLatched ? "Tap to send" : "Talk to Luke")
                .accessibilityHint(
                    isLatched
                        ? "Stops listening and sends your message"
                        : "Tap to keep listening, or hold to talk"
                )
                .accessibilityAction { activateTalkButton() }
        }
    }

    /// VoiceOver invokes the control's default accessibility action rather
    /// than its zero-distance drag gesture. Treat each activation as the
    /// quick-tap path: the first starts a latched turn and the second sends it.
    private func activateTalkButton() {
        if isLatched {
            isLatched = false
            model.endTurn()
        } else {
            model.beginTurn()
            isLatched = true
        }
    }

    private var talkButtonLabel: some View {
        Image(systemName: isPressing || isLatched ? "waveform" : "mic.fill")
            .font(.system(size: 27, weight: .semibold))
            .foregroundStyle(Color.white)
            .frame(width: 58, height: 58)
            .contentTransition(.symbolEffect(.replace))
    }

    private var talkGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { _ in
                guard pressBeganAt == nil else { return }
                pressBeganAt = ProcessInfo.processInfo.systemUptime
                isPressing = true
                // A latched turn is already recording. Its second press says
                // "send" and the release below owns that transition.
                if !isLatched { model.beginTurn() }
            }
            .onEnded { _ in
                guard let beganAt = pressBeganAt else { return }
                let release = talkButtonReleaseAction(
                    heldDuration: ProcessInfo.processInfo.systemUptime - beganAt,
                    wasLatched: isLatched
                )
                pressBeganAt = nil
                isPressing = false
                switch release {
                case .latch:
                    isLatched = true
                case .send:
                    isLatched = false
                    model.endTurn()
                }
            }
    }

    // MARK: - Helpers

    private var talkButtonColor: Color {
        if isPressing || isLatched { return Color(red: 0.25, green: 0.55, blue: 1.0) }
        switch model.status {
        case .thinking: return Color(red: 0.9, green: 0.7, blue: 0.2)
        case .speaking: return Color(red: 0.2, green: 0.8, blue: 0.5)
        default: return Color.accentColor
        }
    }

    private var statusText: String {
        switch model.status {
        case .idle: return model.errorMessage != nil ? "Connection failed" : "Tap or hold to talk"
        case .connecting: return "Connecting…"
        case .ready: return "Tap or hold to talk"
        case .listening: return "Listening…"
        case .thinking: return "Thinking…"
        case .speaking: return "Speaking…"
        }
    }

    private var placeholderText: String {
        model.status == .ready || model.status == .idle
            ? "Tap once, or hold the button and speak."
            : ""
    }
}
