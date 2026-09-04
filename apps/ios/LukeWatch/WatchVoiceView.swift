import LukeKit
import SwiftUI

/// Hold-to-talk voice screen for Apple Watch. Drives WatchVoiceSessionModel,
/// which in turn drives a RealtimeSession.
///
/// The watch ships tool-free: dispatchToolCall always refuses since the armed-act
/// infrastructure (roster validation, ActClient, ProjectsAnswer) lives on the
/// phone. The PR notes this explicitly; a future PR may add a bounded act set.
struct WatchVoiceView: View {
    @Environment(WatchAccountSession.self) private var accountSession
    @State private var model = WatchVoiceSessionModel()
    @State private var isPressing = false

    var body: some View {
        ZStack(alignment: .bottom) {
            messageThread
            floatingControls
        }
        .task {
            await model.start(accountSession: accountSession)
        }
        .onDisappear {
            model.stop()
        }
    }

    // MARK: - Message thread

    private var messageThread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 6) {
                    if model.messages.isEmpty {
                        WatchLukeMark()
                            .foregroundStyle(.secondary)
                            .frame(width: 44, height: 40)
                            .frame(maxWidth: .infinity, minHeight: 80, alignment: .center)
                            .opacity(model.status == .connecting ? 0.4 : 1)
                    } else {
                        ForEach(model.messages) { message in
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
            .onChange(of: model.messages.count) {
                guard let last = model.messages.last else { return }
                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            .onChange(of: model.messages.last?.text) {
                guard let last = model.messages.last else { return }
                proxy.scrollTo(last.id, anchor: .bottom)
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
    let message: WatchVoiceMessage

    var body: some View {
        Text(message.text)
            .font(.system(size: 13))
            .foregroundStyle(message.speaker == .user ? Color.white : Color.primary)
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .background {
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        message.speaker == .user
                            ? Color.accentColor
                            : Color.secondary.opacity(0.18)
                    )
            }
            .frame(maxWidth: .infinity, alignment: message.speaker == .user ? .trailing : .leading)
    }
}
