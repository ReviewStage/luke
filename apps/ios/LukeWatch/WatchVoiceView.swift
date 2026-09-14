import LukeKit
import SwiftUI

/// Hold-to-talk voice screen for Apple Watch, on the hosted exchange: the
/// controls drive `WatchVoiceSessionModel`, which speaks to Luke through the
/// service's audio route, and the thread under them is the stored
/// Conversation, read from the service the way the phone reads it. Both
/// speakers' lines land there through the voice writer, so what the call
/// draws of its own is one caption: Luke's words for the reply under way.
struct WatchVoiceView: View {
    @Environment(WatchAccountSession.self) private var accountSession
    @Environment(WatchRosterStore.self) private var store
    @Environment(ConversationStore.self) private var stored
    @AppStorage(VoiceSettingsKey.voice) private var voice = LiveVoice.default
    @State private var model = WatchVoiceSessionModel()
    @State private var isPressing = false
    @State private var settingsShown = false

    var body: some View {
        ZStack(alignment: .bottom) {
            WatchConversationView(conversation: stored)
            floatingControls
        }
        .task {
            model.voice = voice
            model.prepare(accountSession: accountSession)
            // The Conversation's action rows name sessions off the roster, refreshed as this page opens.
            await store.load()
        }
        .onChange(of: voice) { _, newVoice in model.changeVoice(newVoice) }
        .onDisappear {
            model.hangUp()
        }
        .navigationTitle("Luke")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { settingsButton }
        }
        .sheet(isPresented: $settingsShown) {
            WatchVoiceSettingsView()
        }
    }

    // MARK: - Floating controls

    private var settingsButton: some View {
        Button {
            settingsShown = true
        } label: {
            Label("Voice Settings", systemImage: "gearshape")
        }
        .accessibilityLabel("Voice Settings")
    }

    private var floatingControls: some View {
        VStack(spacing: 4) {
            if let error = model.errorMessage {
                Text(error)
                    .font(.system(size: 10))
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .padding(.horizontal, 8)
            } else if let caption = model.caption, !caption.isEmpty {
                Text(caption)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .truncationMode(.head)
                    .padding(.horizontal, 8)
                    .accessibilityLabel("Luke: \(caption)")
            }
            statusLabel
            HStack(spacing: 12) {
                talkButton
                if model.status == .speaking {
                    stopButton
                }
            }
            .animation(.easeInOut(duration: 0.15), value: model.status)
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
        case .connecting, .closing:
            ProgressView()
                .scaleEffect(0.6)
                .frame(width: 14, height: 14)
        case .listening:
            Image(systemName: "waveform")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.blue)
                .symbolEffect(.variableColor.iterative, isActive: true)
        case .speaking:
            Image(systemName: "speaker.wave.2")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.green)
                .symbolEffect(.variableColor.iterative, isActive: true)
        case .idle, .muted, .failed, .unavailable:
            EmptyView()
        }
    }

    private var statusText: String {
        switch model.status {
        case .idle, .failed, .unavailable: model.errorMessage != nil ? "" : "Hold to talk"
        case .connecting: "Connecting…"
        case .muted: "Hold to talk"
        case .listening: "Listening…"
        case .speaking: "Speaking…"
        case .closing: "Ending…"
        }
    }

    // MARK: - Controls

    private var talkButton: some View {
        Circle()
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
            .disabled(model.status == .closing)
            .accessibilityLabel("Talk to Luke")
            .accessibilityHint("Hold to speak, release to send")
            .accessibilityAddTraits(.allowsDirectInteraction)
    }

    /// Drawn while Luke speaks: ends his reply, on the wrist and at the service.
    private var stopButton: some View {
        Button {
            model.stopSpeaking()
        } label: {
            Image(systemName: "stop.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.secondary.opacity(0.35)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Stop Luke")
    }

    private var buttonColor: Color {
        if isPressing { return Color(red: 0.25, green: 0.55, blue: 1.0) }
        switch model.status {
        case .speaking: return Color(red: 0.2, green: 0.8, blue: 0.5)
        default: return Color.accentColor
        }
    }
}
