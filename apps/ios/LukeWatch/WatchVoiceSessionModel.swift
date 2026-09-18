import Foundation
import LukeKit
import Observation

/// The watch's voice call on the hosted exchange, over the service's audio
/// route: `HostedVoiceSessionClient.createAudio` opens the session under the
/// bearer the phone handed over and the watch's own device row, the service
/// holds the session's primary socket to OpenAI itself, the watch's PCM goes
/// up as `session.input_audio.append` and Luke's comes down as
/// `session.output_audio.delta`, and the service's exchange and the hosted
/// brain answer every ask. The policy is the phone's `LiveCall` on the
/// desktop's terms, less what a primary socket cannot do: there is no attach,
/// so a call ends when the service's function invocation does, the screen
/// says so, and the next press opens a new call. Nothing here appends to the
/// model, no tool call reaches the wrist, and no text of the watch's
/// composing leaves it; the record is the voice writer's, read back by the
/// Conversation under the controls.
///
/// The talk button is held to talk: its press opens a session if none stands
/// and streams the microphone for exactly as long as the press lasts. Between
/// presses the watch streams silence, because the conversations guide asks
/// that input audio keep running through silence on a WebSocket, and it is
/// that silence the model reads the end of the developer's turn from.
@Observable
@MainActor
final class WatchVoiceSessionModel {
    /// The desktop's `HOSTED_VOICE_UNAVAILABLE_NOTE`, the line the phone shows for the same refusal.
    static let hostedUnavailableNote = "Voice is temporarily unavailable. Try again later."
    /// The watch cannot renew a bearer itself, so a refused one is the phone's to replace.
    static let signedOutNote = "Open Luke on your iPhone"
    /// The peer's own word on the phone for every refusal the service says no more about.
    static let refusedNote = "Luke could not open a voice session."
    static let audioNote = "Couldn't start audio on the watch."
    static let microphoneNote = "The microphone isn't available."
    /// The clear end of a call the function's cap or the network ended, as distinct from one the developer or the service closed.
    static let endedNote = "The call ended. Hold to start a new one."

    /// `SPEAKING_HANGOVER_MS`: how long after Luke's last audio he still counts as speaking, so a pause between two sentences is not an exchange ending.
    static let speakingHangover: Duration = .milliseconds(1500)
    /// `LIVE_IDLE_WINDOW_MS`: how long a quiet call stands before it reports itself idle; the service decides the close.
    static let idleWindow: Duration = .milliseconds(VoiceServiceContract.liveIdleWindowMs)
    /// How much silence one frame between presses carries, in milliseconds.
    static let silenceFrameMs = 100

    private(set) var status: LiveStatus = .idle
    /// Why the last open failed or the last call ended, in words the screen can show; cleared by the next press.
    private(set) var errorMessage: String?
    /// Luke's words for the reply under way, from the relayed transcript deltas; cleared by the next press.
    private(set) var caption: String?
    /// The voice the next session is created in, the developer's synced choice.
    var voice: LiveVoice = .default

    @ObservationIgnored private var client: HostedVoiceSessionClient?
    @ObservationIgnored private var session: HostedAudioSession?
    @ObservationIgnored private var sessionReader: Task<Void, Never>?
    /// The open still under way, so a second press reads its answer rather than opening a session of its own.
    @ObservationIgnored private var opening: Task<HostedAudioSession?, Never>?
    /// Counts the opens, so a session the service answers after a hang-up is known for what it is.
    @ObservationIgnored private var openings = 0
    @ObservationIgnored private var pressHeld = false
    @ObservationIgnored private var capturer: PCMAudioCapturer?
    @ObservationIgnored private var captureTask: Task<Void, Never>?
    @ObservationIgnored private var silenceTask: Task<Void, Never>?
    @ObservationIgnored private var player: PCMAudioPlayer?
    /// When the audio queued so far will have played, so the status follows what the wrist hears rather than what arrived.
    @ObservationIgnored private var playbackEndsAt: ContinuousClock.Instant?
    @ObservationIgnored private var speakingWatch: Task<Void, Never>?
    @ObservationIgnored private var idleTimer: Task<Void, Never>?
    @ObservationIgnored private var idleReported = false
    @ObservationIgnored private var closing = false
    @ObservationIgnored private var sessionClosedAnnounced = false

    /// The account the calls are opened under; read at each open through the client's token discipline.
    func prepare(accountSession: WatchAccountSession) {
        client = HostedVoiceSessionClient(
            serviceURL: AccountConstants.serviceURL,
            session: accountSession,
            deviceId: { DeviceRegistrar.storedDeviceId() },
            opener: WatchWebSocketOpener()
        )
    }

    // MARK: - Verbs

    /// The talk button going down. Against no session it opens one; against a
    /// standing one it opens the microphone. A hold that ended while the
    /// session was opening opens no microphone.
    func beginTurn() {
        pressHeld = true
        errorMessage = nil
        caption = nil
        noteActivity()
        Task { [weak self] in
            guard let self, let session = await ensureSession() else { return }
            if pressHeld, self.session === session { startCapturing(into: session) }
        }
    }

    /// The talk button coming up: the microphone closes, and the silence the model reads the turn's end from follows.
    func endTurn() {
        pressHeld = false
        stopCapturing()
        noteActivity()
        refreshStatus()
    }

    /// The stop control: the service is told to stop Luke through
    /// `session.stop`, which it turns into the instruction on its own socket,
    /// and what of his reply the wrist had not yet played is dropped, since
    /// the developer has said they have heard enough.
    func stopSpeaking() {
        guard let session else { return }
        session.stopSpeaking()
        flushPlayback()
        noteActivity()
    }

    /// The hang-up, taken when the screen goes or the voice changes:
    /// `session.close` goes as the one Live client event the route forwards
    /// from the watch, the session answers `session.closed`, and the service
    /// ends the socket normally. The socket is let go on the guide's bound if
    /// that close never comes back, or never got out: a send waits on a path
    /// for as long as the path is down, so the bound is on the whole of the
    /// hang-up and not on the answer alone. An open still under way is
    /// disowned: the session it lands is closed the same way rather than
    /// adopted.
    func hangUp() {
        pressHeld = false
        stopCapturing()
        flushPlayback()
        openings += 1
        guard let session, !closing else {
            if session == nil { endCall(final: .idle) }
            return
        }
        closing = true
        status = .closing
        session.hangUp()
        Task { [weak self] in
            try? await Task.sleep(for: LivePeerBounds.sessionClose)
            guard let self, self.session === session else { return }
            session.close()
        }
    }

    /// The voice is fixed when a session is created, so a changed voice ends the call that stands and lets the next press open one in the new voice.
    func changeVoice(_ newVoice: LiveVoice) {
        guard newVoice != voice else { return }
        voice = newVoice
        if session != nil || opening != nil { hangUp() }
    }

    // MARK: - The open

    /// The session standing or coming up, or a new one opened now. One opening at a time.
    private func ensureSession() async -> HostedAudioSession? {
        if let opening { return await opening.value }
        if let session { return session }
        guard let client else { return nil }
        openings += 1
        let thisOpening = openings
        status = .connecting
        let task = Task { [weak self] () -> HostedAudioSession? in
            guard let self else { return nil }
            return await open(client: client, opening: thisOpening)
        }
        opening = task
        return await task.value
    }

    /// The audio session goes active before the socket opens, since watchOS
    /// grants the socket to an active audio session alone, and stays active
    /// until the call ends. The service's `session.created` is the session
    /// started: the door read `session.started` itself, so the call stands
    /// from the answer. An attempt a hang-up disowned clears nothing on its
    /// way out, since a newer press may hold an attempt of its own by then.
    private func open(client: HostedVoiceSessionClient, opening thisOpening: Int) async -> HostedAudioSession? {
        defer { if thisOpening == openings { opening = nil } }
        do {
            try await WatchVoiceAudioSession.activate()
        } catch {
            if thisOpening == openings, !closing { failed(Self.audioNote) }
            return nil
        }
        let outcome = await client.createAudio(voice: voice)
        guard thisOpening == openings, !closing else {
            // A hang-up landed while the service was answering: the session it created is ended the way a standing one is.
            if case .opened(let session) = outcome {
                session.hangUp()
                Task {
                    await session.settleSends()
                    session.close()
                }
            }
            if session == nil, opening == nil { WatchVoiceAudioSession.deactivate() }
            return nil
        }
        switch outcome {
        case .opened(let session):
            self.session = session
            sessionClosedAnnounced = false
            listen(to: session)
            streamSilence(into: session)
            armIdle()
            refreshStatus()
            return session
        case .refused(let refusal):
            WatchVoiceAudioSession.deactivate()
            failed(Self.note(for: refusal))
            return nil
        }
    }

    /// The service's word on a refusal, in the lines the phone shows for the
    /// same ones. The watch's socket cannot read the status of a refused
    /// upgrade, so a 401, 403, or 503 the service states in the status alone
    /// arrives as the transport failing and reads as Luke not reached.
    static func note(for refusal: HostedVoiceSessionRefusal) -> String {
        switch refusal {
        case .notSignedIn:
            signedOutNote
        case .quotaExhausted(let quota):
            quota.map { "\(hostedUnavailableNote) \(allowance($0))" } ?? hostedUnavailableNote
        case .hostedUnavailable:
            hostedUnavailableNote
        case .networkError:
            WatchNetwork.unreachable
        case .httpError, .refused, .malformedResponse:
            refusedNote
        }
    }

    /// The allowance as the service counts it and the instant it resets.
    static func allowance(_ quota: HostedQuota) -> String {
        let resets = Date(timeIntervalSince1970: quota.resetsAt / 1000)
        return "Your allowance is spent (\(Int(quota.used)) of \(Int(quota.limit))); it resets \(resets.formatted(date: .abbreviated, time: .shortened))."
    }

    private func failed(_ note: String) {
        errorMessage = note
        status = .failed
    }

    // MARK: - Audio up

    private func startCapturing(into session: HostedAudioSession) {
        guard capturer == nil else { return }
        let capturer = PCMAudioCapturer(sampleRate: session.format.rate)
        self.capturer = capturer
        captureTask = Task { [weak self] in
            do {
                let stream = try capturer.start()
                for await chunk in stream {
                    guard let self, !Task.isCancelled else { return }
                    session.appendAudio(chunk)
                }
            } catch {
                guard let self, !Task.isCancelled else { return }
                stopCapturing()
                pressHeld = false
                errorMessage = Self.microphoneNote
                refreshStatus()
            }
        }
        refreshStatus()
    }

    private func stopCapturing() {
        captureTask?.cancel()
        captureTask = nil
        capturer?.stop()
        capturer = nil
    }

    /// Silence in the session's format whenever the microphone is closed, on a steady cadence, for as long as the call stands.
    private func streamSilence(into session: HostedAudioSession) {
        let frame = [Int16](repeating: 0, count: session.format.rate * Self.silenceFrameMs / 1000)
        silenceTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(Self.silenceFrameMs))
                guard !Task.isCancelled, let self else { return }
                if capturer == nil { session.appendAudio(frame) }
            }
        }
    }

    // MARK: - Audio down

    /// Everything the session tells the watch. Luke's audio plays as it
    /// arrives; the captions and the developer's own transcript are activity;
    /// the socket's end for good is the call's end. The silence GPT Live
    /// streams between his turns is neither his voice nor activity: played,
    /// it would hold the speaking status for as long as the call stands, and
    /// counted, it would keep the idle report from ever going.
    private func listen(to session: HostedAudioSession) {
        sessionReader = Task { [weak self] in
            for await event in session.events {
                guard let self else { return }
                switch event {
                case .live(let frame):
                    receive(frame)
                case .spoken:
                    noteActivity()
                case .closed:
                    sessionEnded()
                    return
                }
            }
        }
    }

    private func receive(_ frame: LiveServerEventFrame) {
        if let samples = PCM16Audio.samples(in: frame) {
            guard !PCM16Audio.isSilence(samples) else { return }
            play(samples)
            noteActivity()
            return
        }
        guard let event = LiveServerEvent(json: frame.payload) else { return }
        switch event {
        case .outputTranscriptDelta(let delta):
            caption = (caption ?? "") + delta.delta
            noteActivity()
        case .inputTranscriptDelta:
            noteActivity()
        case .sessionClosed:
            sessionClosedAnnounced = true
        case .sessionStarted, .inputAudioMuted, .inputAudioUnmuted, .usageUpdated, .error, .info:
            break
        }
    }

    /// Queues one chunk of Luke's voice and moves the moment the queue runs
    /// dry, which is what the speaking status follows: GPT Live emits no
    /// output-audio-done event, so the playback queue is the one thing that
    /// says which received audio has played.
    private func play(_ samples: [Int16]) {
        guard let session, !samples.isEmpty else { return }
        if player == nil { player = PCMAudioPlayer(sampleRate: session.format.rate) }
        player?.enqueue(samples)
        let now = ContinuousClock.now
        let start = max(playbackEndsAt ?? now, now)
        playbackEndsAt = start + .seconds(Double(samples.count) / Double(session.format.rate))
        watchPlayback()
    }

    private func watchPlayback() {
        speakingWatch?.cancel()
        guard let endsAt = playbackEndsAt else { return }
        refreshStatus()
        speakingWatch = Task { [weak self] in
            try? await Task.sleep(until: endsAt + Self.speakingHangover, clock: .continuous)
            guard !Task.isCancelled, let self else { return }
            playbackEndsAt = nil
            speakingWatch = nil
            refreshStatus()
        }
    }

    private func flushPlayback() {
        player?.stop()
        player = nil
        playbackEndsAt = nil
        speakingWatch?.cancel()
        speakingWatch = nil
        refreshStatus()
    }

    // MARK: - Idle

    /// Either speaker heard, or the button moved: the idle window starts over, and an idle already reported is taken back.
    private func noteActivity() {
        guard let session else { return }
        if idleReported {
            idleReported = false
            session.reportActivity(idle: false)
        }
        armIdle()
    }

    private func armIdle() {
        idleTimer?.cancel()
        idleTimer = Task { [weak self] in
            try? await Task.sleep(for: Self.idleWindow)
            guard !Task.isCancelled, let self, let session, !idleReported else { return }
            idleReported = true
            session.reportActivity(idle: true)
        }
    }

    // MARK: - State

    private func refreshStatus() {
        guard session != nil, !closing else { return }
        status = playbackEndsAt != nil ? .speaking : capturer != nil ? .listening : .muted
    }

    /// The socket ended for good. The session closing on its own word, or
    /// the developer's hang-up, is a plain end; the function's cap or a
    /// dropped path, which announce nothing, are said so the wrist knows the
    /// call is over and a press starts another.
    private func sessionEnded() {
        let announced = sessionClosedAnnounced
        let hungUp = closing
        endCall(final: .idle)
        if !announced, !hungUp { errorMessage = Self.endedNote }
    }

    /// Every end of the call, however it came: the timers and the audio go,
    /// the socket is let go of, and the audio session goes down only now,
    /// because taking it down under a standing socket would cut the socket.
    private func endCall(final: LiveStatus) {
        idleTimer?.cancel()
        idleTimer = nil
        idleReported = false
        stopCapturing()
        flushPlayback()
        silenceTask?.cancel()
        silenceTask = nil
        sessionReader?.cancel()
        sessionReader = nil
        session?.close()
        session = nil
        opening = nil
        closing = false
        sessionClosedAnnounced = false
        WatchVoiceAudioSession.deactivate()
        status = final
    }
}
