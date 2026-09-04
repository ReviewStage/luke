import LukeKit
import SwiftUI

/// Hold-to-talk voice screen for Apple Watch. Drives WatchVoiceSessionModel,
/// which in turn drives a RealtimeSession carrying the same tools the phone's
/// conversation does: each call is validated through LukeKit's shared
/// dispatcher against the roster the sessions page draws, and an open or a
/// list ask lands on that page once Luke has finished speaking.
struct WatchVoiceView: View {
    @Environment(WatchAccountSession.self) private var accountSession
    @Environment(WatchRosterStore.self) private var store
    @Environment(WatchNavigation.self) private var navigation
    @Environment(VoiceConversationThread.self) private var conversation
    @State private var model = WatchVoiceSessionModel()
    @State private var isPressing = false
    private let actClient = ActClient(baseURL: AccountConstants.serviceURL)

    var body: some View {
        ZStack(alignment: .bottom) {
            messageThread
            floatingControls
        }
        .task {
            model.prepare(
                accountSession: accountSession, thread: conversation, actContext: makeActContext
            )
            // The roster the acts are validated against is the list's own,
            // refreshed as this page opens so a session archived since the
            // list last polled is not offered as somewhere to act.
            await store.load()
        }
        .onChange(of: model.status) { _, newStatus in
            if newStatus == .ready || newStatus == .idle {
                performPendingNavigation()
            }
        }
        .onDisappear {
            model.stop()
        }
    }

    /// What a tool call is carried against, read at the moment of the call.
    /// An open or a list ask is held for the reply to finish rather than
    /// performed at once: the page moving mid-sentence would close the call
    /// still speaking the words that announce it.
    private func makeActContext() -> VoiceActContext {
        VoiceActContext(
            mintedTools: model.mintedTools,
            sessions: store.sessions,
            projects: model.projects,
            defaults: model.defaults,
            actClient: actClient,
            accessToken: { [accountSession] in try await accountSession.validAccessToken() },
            // The watch posts no product events — none of the acts its own
            // screens carry count either — so a spoken act counts nothing
            // here rather than posting under another app's tag.
            count: { _, _ in },
            refreshRoster: { [store] in await store.load() },
            // One page, so the last open a reply names is the one taken.
            open: { [model] session in model.pendingNavigation = .open(session) },
            showList: { [model] ask in model.pendingNavigation = .list(ask) }
        )
    }

    /// Takes the developer where the settled reply said they were going. The
    /// page changes either way, and this view's `onDisappear` closes the
    /// call behind it.
    private func performPendingNavigation() {
        guard let pending = model.pendingNavigation else { return }
        model.pendingNavigation = nil
        switch pending {
        case .open(let session):
            navigation.open(session)
        case .list(let ask):
            store.showList(ask)
            navigation.showList()
        }
    }

    // MARK: - Message thread

    private var messageThread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 6) {
                    if conversation.messages.isEmpty {
                        WatchLukeMark()
                            .foregroundStyle(.secondary)
                            .frame(width: 44, height: 40)
                            .frame(maxWidth: .infinity, minHeight: 80, alignment: .center)
                            .opacity(model.status == .connecting ? 0.4 : 1)
                    } else {
                        ForEach(conversation.messages) { message in
                            WatchVoiceBubble(message: message)
                                .id(message.id)
                        }
                    }
                }
                .padding(.horizontal, 4)
                .padding(.top, 8)
                // Bottom padding so the newest bubble clears the floating controls
                // while still being reachable by scroll.
                .padding(.bottom, 88)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: conversation.messages) {
                guard let last = conversation.messages.last else { return }
                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            .onAppear {
                if let last = conversation.messages.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Floating controls

    private var floatingControls: some View {
        VStack(spacing: 4) {
            if let error = model.errorMessage {
                Text(error)
                    .font(.system(size: 10))
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .padding(.horizontal, 8)
            }
            statusLabel
            talkButton
        }
        .padding(.bottom, 4)
    }

    // MARK: - Status label

    private var statusLabel: some View {
        HStack(spacing: 4) {
            statusGlyph
            Text(statusText)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .animation(.easeInOut(duration: 0.15), value: model.status)
    }

    @ViewBuilder
    private var statusGlyph: some View {
        switch model.status {
        case .connecting:
            ProgressView()
                .scaleEffect(0.6)
                .frame(width: 14, height: 14)
        case .listening:
            Image(systemName: "waveform")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.blue)
                .symbolEffect(.variableColor.iterative, isActive: true)
        case .thinking:
            Image(systemName: "ellipsis")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.yellow)
                .symbolEffect(.variableColor.iterative, isActive: true)
        case .speaking:
            Image(systemName: "speaker.wave.2")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.green)
                .symbolEffect(.variableColor.iterative, isActive: true)
        default:
            EmptyView()
        }
    }

    private var statusText: String {
        switch model.status {
        case .idle: model.errorMessage != nil ? "" : "Hold to talk"
        case .connecting: "Connecting…"
        case .ready: "Hold to talk"
        case .listening: "Listening…"
        case .thinking: "Thinking…"
        case .speaking: "Speaking…"
        }
    }

    // MARK: - Hold-to-talk button

    private var talkButton: some View {
        let canTalk = model.status == .ready
            || model.status == .idle
            || model.status == .connecting
            || model.status == .listening
            || model.status == .speaking
            || isPressing

        return Circle()
            .fill(buttonColor)
            .frame(width: 52, height: 52)
            .overlay {
                Image(systemName: isPressing ? "waveform" : "mic.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
                    .contentTransition(.symbolEffect(.replace))
            }
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !isPressing else { return }
                        isPressing = true
                        model.beginTurn()
                    }
                    .onEnded { _ in
                        guard isPressing else { return }
                        isPressing = false
                        model.endTurn()
                    }
            )
            .disabled(!canTalk)
            .accessibilityLabel("Talk to Luke")
            .accessibilityHint("Hold to speak, release to send")
            .accessibilityAddTraits(.allowsDirectInteraction)
    }

    private var buttonColor: Color {
        if isPressing { return Color(red: 0.25, green: 0.55, blue: 1.0) }
        switch model.status {
        case .thinking: return Color(red: 0.9, green: 0.7, blue: 0.2)
        case .speaking: return Color(red: 0.2, green: 0.8, blue: 0.5)
        default: return Color.accentColor
        }
    }
}

// MARK: - Message bubble

private struct WatchVoiceBubble: View {
    let message: VoiceConversationMessage

    private var isDeveloper: Bool { message.speaker == .developer }

    var body: some View {
        Text(message.words)
            .font(.system(size: 13))
            .foregroundStyle(isDeveloper ? Color.white : Color.primary)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .background {
                RoundedRectangle(cornerRadius: 12)
                    .fill(isDeveloper ? Color.accentColor : Color.secondary.opacity(0.18))
            }
            .frame(maxWidth: .infinity, alignment: isDeveloper ? .trailing : .leading)
    }
}
