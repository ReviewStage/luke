import AVFoundation
import Foundation
import LukeKit
import SwiftUI

// MARK: - Talk button

/// Longer than a normal tap, short enough that a tap does not feel delayed.
/// This matches the desktop talk-key interaction.
let talkButtonTapDuration: TimeInterval = 0.25

enum TalkButtonReleaseAction: Sendable, Equatable {
    /// Leave the microphone open until the next press and release.
    case latch
    /// Close the open microphone now.
    case send
}

/// A held first press closes the microphone on release. A quick first tap
/// leaves it open, and any release after that latched hold closes it.
func talkButtonReleaseAction(
    heldDuration: TimeInterval,
    wasLatched: Bool
) -> TalkButtonReleaseAction {
    if wasLatched { return .send }
    return heldDuration < talkButtonTapDuration ? .latch : .send
}

// MARK: - VoiceView

/// The phone as a WebRTC peer with captions, on the desktop's terms. A press
/// opens the peer, creates the session over the sessions socket in the
/// account's synced voice, and is heard for exactly as long as it lasts, or
/// until the next tap after a quick first one; the service's exchange runs
/// the conversation, the hosted brain answers, and the record is written
/// server-side, so what is said here appears in the Conversation on this
/// phone and on a Mac signed into the same account. What this screen draws
/// is both speakers' captions off the data channel, rows settling in place,
/// and it holds them only while the call stands. Nothing is typed here and
/// no tool call reaches this screen; the words are masked from session replay
/// by the bubbles they share with the session chat.
struct VoiceView: View {
    /// The stored Conversation this screen stands on, the thread both speakers' lines land in.
    let conversation: ConversationStore

    /// The system's grant is the one thing the press needs that the service cannot give it.
    private static let microphoneRefusedNote =
        "The talk button needs the microphone. Allow it in Settings, under Privacy & Security, Microphone."

    @Environment(AccountSession.self) private var accountSession
    @Environment(ProductEventSender.self) private var events
    @AppStorage(VoiceSettingsKey.voice) private var voice = LiveVoice.default
    /// The call, built at the first appearance over the account and the framework's peer factory; one per visit.
    @State private var call: LiveCall?
    @State private var isPressing = false
    @State private var isLatched = false
    @State private var pressBeganAt: TimeInterval?
    @State private var settingsShown = false
    @State private var microphoneNote: String?

    var body: some View {
        ZStack {
            ConversationView(conversation: conversation, bottomInset: Self.controlsClearance)
            if !captions.isEmpty {
                captionLines
                    .background(Color.ground.ignoresSafeArea())
                    .transition(.opacity)
            }
            bottomControls
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.ground.ignoresSafeArea())
        .navigationTitle("Luke")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { settingsButton }
        }
        .sheet(isPresented: $settingsShown) {
            VoiceSettingsSheet()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .onAppear {
            if call == nil { call = makeCall() }
        }
        // The voice is the session's from its creation, so a standing call
        // ends and the next press opens one in the new voice.
        .onChange(of: voice) { _, _ in
            guard let call, call.standing else { return }
            isLatched = false
            Task { await call.hangUp() }
        }
        // A latch outlives nothing but the session it holds the microphone
        // open on; the stop control drops it by hand.
        .onChange(of: call?.status) { _, newStatus in
            if newStatus == .idle || newStatus == .failed { isLatched = false }
        }
        // The screen's state outlives the screen (the tab, the Conversation
        // pushed over it), so the latch goes with the call it held open.
        .onDisappear {
            isLatched = false
            guard let call else { return }
            Task { await call.hangUp() }
        }
    }

    /// The call over the framework's peer factory and the sessions socket
    /// client, under the account's bearer and this installation's device row.
    /// The voice is read at each open, so a change lands on the next session.
    private func makeCall() -> LiveCall {
        let factory = WebRTCPeerFactory()
        let client = HostedVoiceSessionClient(
            serviceURL: AccountConstants.serviceURL,
            session: accountSession,
            deviceId: { DeviceRegistrar.storedDeviceId() }
        )
        let events = events
        return LiveCall(
            seams: LiveCallSeams(
                makePeerConnection: { try factory.makePeerConnection() },
                openMicrophone: { try factory.openMicrophone() },
                createSession: { sdp, voice in await client.create(sdpOffer: sdp, voice: voice).sideband },
                voice: { DeviceSettingsSnapshot.read(from: .standard).voice },
                onCallStarted: { events.record(.voiceCallStart(source: .hosted)) }
            )
        )
    }

    // MARK: - The press

    /// The talk button going down. The system's microphone grant is asked for
    /// first, at the press, which is the user action the WebRTC guide asks it
    /// be requested from. The dialog takes the press with it: a press that
    /// raised it is over whatever the touch reports, and a grant opens
    /// nothing until the next press, as a hold let go of under the Mac's
    /// dialog opens nothing there. A press the grant refuses latches nothing
    /// either: a latch is only ever taken with the microphone granted.
    private func beginPress() {
        guard let call else { return }
        microphoneNote = nil
        Task {
            guard await microphoneAllowed() else { return }
            guard isPressing || isLatched else { return }
            await call.beginTalk()
        }
    }

    private func endPress() {
        guard let call else { return }
        Task { await call.endTalk() }
    }

    /// The stop control: Luke is told to stop through the service, and the microphone closes.
    private func stopSpeaking() {
        guard let call else { return }
        isLatched = false
        Task { await call.stopSpeaking() }
    }

    private func microphoneAllowed() async -> Bool {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            return true
        case .denied:
            isLatched = false
            microphoneNote = Self.microphoneRefusedNote
            return false
        case .undetermined:
            isLatched = false
            let granted = await AVAudioApplication.requestRecordPermission()
            isLatched = false
            if !granted { microphoneNote = Self.microphoneRefusedNote }
            return false
        @unknown default:
            return true
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

    private var status: LiveStatus { call?.status ?? .idle }

    private var captions: [LiveCaptionRow] { call?.captions ?? [] }

    /// Empty space at the tail of a thread so its newest row clears the floating controls.
    private static let controlsClearance: CGFloat = 200

    private var statusLabel: some View {
        HStack(spacing: 5) {
            statusGlyph
            Text(statusText)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color.inkSecondary)
        }
        .animation(.easeInOut(duration: 0.15), value: status)
    }

    @ViewBuilder
    private var statusGlyph: some View {
        switch status {
        case .connecting, .closing:
            ProgressView()
                .tint(Color.inkSecondary)
                .scaleEffect(0.7)
                .frame(width: 16, height: 16)
        case .listening:
            Image(systemName: "waveform")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color(red: 0.25, green: 0.55, blue: 1.0))
                .symbolEffect(.variableColor.iterative, isActive: true)
        case .speaking:
            Image(systemName: "speaker.wave.2")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color(red: 0.2, green: 0.8, blue: 0.5))
                .symbolEffect(.variableColor.iterative, isActive: true)
        case .unavailable, .idle, .muted, .failed:
            EmptyView()
        }
    }

    /// Both speakers' rows as the call groups them, each stable from the
    /// moment it opens and growing in place, so a late fragment never moves a
    /// bubble. The bubbles are the session chat's, which is what masks the
    /// developer's words from session replay.
    private var captionLines: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 14) {
                    // Tagged for the proxy, as every scroll target in this app is.
                    ForEach(captions) { row in
                        captionBubble(row).id(row.rowId)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .top)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                // The controls float above the rows. Empty space at the tail
                // lets the newest bubble clear them while the bubbles
                // themselves can still scroll behind the glass.
                .padding(.bottom, Self.controlsClearance)
            }
            .onChange(of: captions) {
                guard let last = captions.last else { return }
                withAnimation { proxy.scrollTo(last.rowId, anchor: .bottom) }
            }
        }
        .frame(maxHeight: .infinity)
    }

    @ViewBuilder
    private func captionBubble(_ row: LiveCaptionRow) -> some View {
        switch row.speaker {
        case .user: DeveloperMessageBubble(words: row.words)
        case .assistant: AgentMessageBubble(words: row.words)
        }
    }

    private var bottomControls: some View {
        VStack(spacing: 10) {
            Spacer()
            if let note = call?.errorMessage ?? microphoneNote {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(Color.errorInk)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            controlsStage
        }
        .padding(.bottom, 10)
        .animation(.easeInOut(duration: 0.2), value: call?.errorMessage ?? microphoneNote)
    }

    /// Every glass shape in one container. Earlier systems keep the same
    /// standard view transition without Liquid Glass.
    @ViewBuilder
    private var controlsStage: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer {
                controlsContent
            }
        } else {
            controlsContent
        }
    }

    private var controlsContent: some View {
        VStack(spacing: 10) {
            statusLabel
            ZStack(alignment: .bottom) {
                if status == .speaking {
                    stopButton
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .transition(.scale.combined(with: .opacity))
                }
                talkButton
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 12)
        }
        .animation(.smooth(duration: 0.25), value: status == .speaking)
    }

    /// The stop control, drawn while Luke speaks: the desktop's stop key, on a phone.
    @ViewBuilder
    private var stopButton: some View {
        if #available(iOS 26.0, *) {
            Button(action: stopSpeaking) { stopButtonLabel }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: Circle())
                .accessibilityLabel("Stop Luke")
                .accessibilityHint("Stops Luke speaking and closes the microphone")
        } else {
            Button(action: stopSpeaking) { stopButtonLabel }
                .buttonStyle(.plain)
                .background(Color.cardFill, in: Circle())
                .overlay(Circle().strokeBorder(Color.controlStroke, lineWidth: 1))
                .accessibilityLabel("Stop Luke")
                .accessibilityHint("Stops Luke speaking and closes the microphone")
        }
    }

    private var stopButtonLabel: some View {
        Image(systemName: "stop.fill")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Color.ink)
            .frame(width: 44, height: 44)
    }

    // Keep the button enabled while the user is actively pressing — disabling
    // during .listening would cancel the in-flight DragGesture and fire
    // onEnded immediately, collapsing every hold into an instant tap. Only a
    // call on its way out refuses a press, since the next one opens afresh.
    private var canTalk: Bool {
        status != .closing || isPressing
    }

    @ViewBuilder
    private var talkButton: some View {
        if #available(iOS 26.0, *) {
            Button(action: {}) { talkButtonLabel }
                .buttonStyle(.plain)
                .glassEffect(.regular.tint(talkButtonColor).interactive(), in: Circle())
                .simultaneousGesture(talkGesture)
                .disabled(!canTalk)
                .accessibilityLabel(isLatched ? "Stop listening" : "Talk to Luke")
                .accessibilityHint(
                    isLatched
                        ? "Closes the microphone"
                        : "Tap to keep listening, or hold to talk"
                )
                .accessibilityAction { activateTalkButton() }
        } else {
            Button(action: {}) { talkButtonLabel }
                .buttonStyle(.plain)
                .background(talkButtonColor, in: Circle())
                .simultaneousGesture(talkGesture)
                .disabled(!canTalk)
                .accessibilityLabel(isLatched ? "Stop listening" : "Talk to Luke")
                .accessibilityHint(
                    isLatched
                        ? "Closes the microphone"
                        : "Tap to keep listening, or hold to talk"
                )
                .accessibilityAction { activateTalkButton() }
        }
    }

    /// VoiceOver invokes the control's default accessibility action rather
    /// than its zero-distance drag gesture. Treat each activation as the
    /// quick-tap path: the first opens a latched hold and the second closes it.
    private func activateTalkButton() {
        if isLatched {
            isLatched = false
            endPress()
        } else {
            isLatched = true
            beginPress()
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
                // A latched hold is already being heard. Its second press
                // says "close" and the release below owns that transition.
                if !isLatched { beginPress() }
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
                    // A tap the system's dialog cut short, or one the grant
                    // refuses, leaves nothing to hold open.
                    isLatched = AVAudioApplication.shared.recordPermission == .granted
                case .send:
                    isLatched = false
                    endPress()
                }
            }
    }

    // MARK: - Helpers

    private var talkButtonColor: Color {
        if isPressing || isLatched { return Color(red: 0.25, green: 0.55, blue: 1.0) }
        return status == .speaking ? Color(red: 0.2, green: 0.8, blue: 0.5) : Color.accentColor
    }

    private var statusText: String {
        switch status {
        case .idle: return call?.errorMessage != nil ? "Connection failed" : "Hold to talk"
        case .connecting: return "Connecting…"
        // A press's session passes through muted between its start and the
        // unmute's acknowledgment, which is not yet the developer being heard.
        case .muted: return isPressing || isLatched ? "Connecting…" : "Hold to talk"
        case .listening: return "Listening…"
        case .speaking: return "Speaking…"
        case .closing: return "Ending…"
        case .failed: return "Connection failed"
        case .unavailable: return LiveCall.voiceKeylessNote
        }
    }
}
