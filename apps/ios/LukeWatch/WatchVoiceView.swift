import LukeKit
import SwiftUI

/// Hold-to-talk voice screen for Apple Watch. Drives WatchVoiceSessionModel,
/// which in turn drives a RealtimeSession.
///
/// The watch ships tool-free: dispatchToolCall always refuses since the armed-act
/// infrastructure (roster validation, ActClient, ProjectsAnswer) lives on the
/// phone. The PR notes this explicitly; a future PR may add a bounded act set.
///
/// Captions are drawn as plain text — the watch has no session recording to mask
/// them from, unlike the iPhone's SessionReplay.
struct WatchVoiceView: View {
    @Environment(WatchAccountSession.self) private var accountSession
    @State private var model = WatchVoiceSessionModel()
    @State private var isPressing = false

    var body: some View {
        VStack(spacing: 4) {
            captionArea
            Spacer(minLength: 0)
            statusLabel
            if let error = model.errorMessage {
                Text(error)
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            talkButton
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 4)
        .navigationTitle("Luke")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await model.start(accountSession: accountSession)
        }
        .onDisappear {
            model.stop()
        }
    }

    // MARK: - Caption area

    private var captionArea: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    if !model.spokenAsk.isEmpty {
                        Text(model.spokenAsk)
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("ask")
                    }
                    if !model.captionText.isEmpty {
                        Text(model.captionText)
                            .font(.system(size: 13))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("caption")
                    }
                    if model.spokenAsk.isEmpty && model.captionText.isEmpty {
                        Text(placeholderText)
                            .font(.system(size: 13))
                            .foregroundStyle(.tertiary)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.top, 4)
            }
            .frame(maxWidth: .infinity)
            .onChange(of: model.captionText) {
                withAnimation { proxy.scrollTo("caption", anchor: .bottom) }
            }
            .onChange(of: model.spokenAsk) {
                withAnimation { proxy.scrollTo("ask", anchor: .top) }
            }
        }
    }

    private var placeholderText: String {
        switch model.status {
        case .idle, .ready: "Hold the button and speak"
        case .connecting: ""
        case .listening, .thinking, .speaking: ""
        }
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
