import Foundation
import Observation

// The phone's voice call on the hosted exchange: `LivePeer` (the WebRTC peer,
// `live-peer.ts`) wired to `HostedVoiceSessionClient` (the sessions socket,
// `live-session-source.ts`) under the policy the desktop's `live-call.ts` and
// `LiveVoiceOrchestrator` keep between them. The phone owns the microphone
// switch and the hang-up and nothing else: a press opens the peer, hands its
// offer to the service as `session.create` with the account's synced voice and
// an empty seed, applies the answer, and unmutes for exactly as long as the
// press lasts; the service's exchange attaches by build, the hosted brain
// answers every ask, and the voice writer puts both speakers' lines on the
// Conversation, which is where the record lives. Nothing here appends to the
// model, no tool call reaches the phone, and no text of the phone's composing
// leaves it.

/// What the call needs of a standing session on the sessions socket, which
/// `HostedVoiceSession` is; a protocol so the call's tests hand in a session
/// of their own.
@MainActor
public protocol LiveSessionSideband: AnyObject {
    /// The answer as `LivePeerSeams.createSession` hands it to the peer.
    var created: LiveSessionCreated { get }
    /// Everything the session tells the phone, ending with `closed`.
    var events: AsyncStream<HostedVoiceSessionEvent> { get }
    func reportActivity(idle: Bool)
    func stopSpeaking()
    func hangUp()
    /// Every send queued so far is on the wire, so a `close()` after it drops nothing.
    func settleSends() async
    func close()
}

extension HostedVoiceSession: LiveSessionSideband {}

/// What creating a session answered, over the sideband seam.
public enum LiveSessionOpening {
    case opened(any LiveSessionSideband)
    case refused(HostedVoiceSessionRefusal)
}

extension HostedVoiceSessionOpening {
    /// The client's answer as the call's seam takes it.
    public var sideband: LiveSessionOpening {
        switch self {
        case .opened(let session): .opened(session)
        case .refused(let refusal): .refused(refusal)
        }
    }
}

/// The desktop's bounds on the call, kept to the millisecond.
public enum LiveCallBounds {
    /// `SPEAKING_HANGOVER_MS`: how long after Luke's last words he still counts as speaking, so a pause between two sentences is not an exchange ending.
    public static let speakingHangover: Duration = .milliseconds(1500)
    /// `CAPTION_SETTLE_TICK_MS`: how often the caption rows are re-read for ones that have settled since their last fragment.
    public static let captionSettleTick: Duration = .milliseconds(500)
    /// `LIVE_IDLE_WINDOW_MS`: how long a quiet peer stands before it reports itself idle; the service decides the close.
    public static let idleWindow: Duration = .milliseconds(VoiceServiceContract.liveIdleWindowMs)
}

/// What the call is built over and reports to.
public struct LiveCallSeams: Sendable {
    public var makePeerConnection: @MainActor @Sendable () throws -> any LivePeerConnection
    public var openMicrophone: @MainActor @Sendable () throws -> any LiveAudioTrack
    /// The service creating one session for the offer, in the voice given.
    public var createSession: @MainActor @Sendable (_ sdp: String, _ voice: LiveVoice) async -> LiveSessionOpening
    /// The account's synced voice, read at each open.
    public var voice: @MainActor @Sendable () -> LiveVoice
    /// `session.created` landed: the moment a call is counted, as the desktop counts it.
    public var onCallStarted: @MainActor @Sendable () -> Void
    /// The clock the captions settle on.
    public var now: @MainActor @Sendable () -> Date
    /// The wait the idle window stands on, injected so a test ends the window
    /// itself rather than sleeping through it on the runner's clock. It must
    /// return or throw promptly when the task awaiting it is cancelled, as
    /// `Task.sleep` does, since a word arriving cancels the window standing.
    /// The speaking hangover and the caption settle tick keep their own
    /// `Task.sleep`: this is the one wait whose passing puts a frame on the
    /// wire.
    public var idleSleep: VoiceSleep
    public var idleWindow: Duration
    public var speakingHangover: Duration
    public var captionSettleTick: Duration
    public var iceGatheringTimeout: Duration
    public var sessionStartTimeout: Duration
    public var acknowledgmentTimeout: Duration
    public var sessionCloseTimeout: Duration

    public init(
        makePeerConnection: @MainActor @Sendable @escaping () throws -> any LivePeerConnection,
        openMicrophone: @MainActor @Sendable @escaping () throws -> any LiveAudioTrack,
        createSession: @MainActor @Sendable @escaping (_ sdp: String, _ voice: LiveVoice) async -> LiveSessionOpening,
        voice: @MainActor @Sendable @escaping () -> LiveVoice,
        onCallStarted: @MainActor @Sendable @escaping () -> Void = {},
        now: @MainActor @Sendable @escaping () -> Date = Date.init,
        idleSleep: @escaping VoiceSleep = { try await Task.sleep(for: $0) },
        idleWindow: Duration = LiveCallBounds.idleWindow,
        speakingHangover: Duration = LiveCallBounds.speakingHangover,
        captionSettleTick: Duration = LiveCallBounds.captionSettleTick,
        iceGatheringTimeout: Duration = LivePeerBounds.iceGathering,
        sessionStartTimeout: Duration = LivePeerBounds.sessionStart,
        acknowledgmentTimeout: Duration = LivePeerBounds.acknowledgment,
        sessionCloseTimeout: Duration = LivePeerBounds.sessionClose
    ) {
        self.makePeerConnection = makePeerConnection
        self.openMicrophone = openMicrophone
        self.createSession = createSession
        self.voice = voice
        self.onCallStarted = onCallStarted
        self.now = now
        self.idleSleep = idleSleep
        self.idleWindow = idleWindow
        self.speakingHangover = speakingHangover
        self.captionSettleTick = captionSettleTick
        self.iceGatheringTimeout = iceGatheringTimeout
        self.sessionStartTimeout = sessionStartTimeout
        self.acknowledgmentTimeout = acknowledgmentTimeout
        self.sessionCloseTimeout = sessionCloseTimeout
    }
}

/// The one voice call as the screen drives it. The talk button is held to
/// talk: its press opens a session if none stands and unmutes it, its release
/// mutes, and the microphone is heard exactly between the two; the stop
/// control mutes the same way and, where Luke is speaking, sends the
/// service's `session.stop`. Both speakers' captions are drawn from the data
/// channel's transcript deltas, rows settling in place; Luke counts as
/// speaking from his own words arriving, held through his pauses; and the
/// peer's own idle window is reported as `session.activity`, with the close
/// the service's decision. What the screen reads is observable; every verb is
/// awaited on the main actor.
@Observable
@MainActor
public final class LiveCall {
    /// The desktop's `VOICE_KEYLESS_NOTE`: the service found no signed-in account behind the request.
    public static let voiceKeylessNote = "Voice is off: sign in to turn it on."
    /// The desktop's `HOSTED_VOICE_UNAVAILABLE_NOTE`: the hosted tier is switched off, not answering, or at its ceiling.
    public static let hostedUnavailableNote = "Voice is temporarily unavailable. Try again later."

    public private(set) var status: LiveStatus = .idle
    /// Both speakers' rows, in the order they opened, each growing in place until it settles.
    public private(set) var captions: [LiveCaptionRow] = []
    /// Why the last open failed, in words the screen can show; cleared by the next open.
    public private(set) var errorMessage: String?

    @ObservationIgnored private let seams: LiveCallSeams
    @ObservationIgnored private var peer: LivePeer?
    @ObservationIgnored private var session: (any LiveSessionSideband)?
    @ObservationIgnored private var sessionReader: Task<Void, Never>?
    @ObservationIgnored private var ledger: LiveCaptions
    /// Whether the talk button is down, so a release during the opening leaves the session muted.
    @ObservationIgnored private var pressHeld = false
    /// The open still negotiating, so a second press reads its answer rather than opening a peer of its own.
    @ObservationIgnored private var opening: Task<Bool, Never>?
    /// Counts the opens, so a session the service answers for an earlier peer's offer is known for what it is.
    @ObservationIgnored private var openings = 0
    @ObservationIgnored private var closing = false
    /// The hang-up under way, so a press landing during it waits for it rather than joining the call on its way out.
    @ObservationIgnored private var hangingUp: Task<Void, Never>?
    @ObservationIgnored private var lukeSpeaking = false
    @ObservationIgnored private var idleTimer: Task<Void, Never>?
    @ObservationIgnored private var idleReported = false
    @ObservationIgnored private var speakingHangover: Task<Void, Never>?
    @ObservationIgnored private var captionTick: Task<Void, Never>?
    /// The service's own reason for a refusal, shown in place of the peer's word where it says more.
    @ObservationIgnored private var refusalNote: String?
    /// Settled when the peer ends, however it came to; what a hang-up waits on after asking the service to close.
    @ObservationIgnored private var peerEnded = Settlement<Bool>()

    public init(seams: LiveCallSeams) {
        self.seams = seams
        ledger = LiveCaptions(now: seams.now)
    }

    /// Whether a session stands or is coming up, so a second press unmutes rather than opening again.
    public var standing: Bool { peer?.standing == true }

    /// Whether the developer's microphone is being heard.
    public var listening: Bool { peer?.listening == true }

    /// The session the service created for this call, once its offer was answered.
    public var sessionId: String? { peer?.sessionId }

    // MARK: - Verbs

    /// The talk button going down. Against no session it opens one and
    /// unmutes it; against a standing session it unmutes. It never mutes: the
    /// button coming up does that, so a hold is heard for exactly as long as
    /// it lasts, and a hold that ended while the session was opening unmutes
    /// nothing, since the microphone rode the offer disabled.
    public func beginTalk() async {
        pressHeld = true
        guard let peer = await ensureSession() else { return }
        if pressHeld, await peer.unmute() { noteActivity() }
    }

    /// The talk button coming up: the microphone closes. A release while the
    /// press's session is still opening leaves it to open muted, and one with
    /// no press behind it does nothing.
    public func endTalk() async {
        guard pressHeld else { return }
        pressHeld = false
        if opening != nil { return }
        guard let peer, peer.standing else { return }
        _ = await peer.mute()
        armIdle()
    }

    /// The stop control: the microphone closes, and where Luke is actually
    /// speaking the service is told to stop him first, through `session.stop`,
    /// which it intercepts and turns into the instruction on its own sideband.
    /// A press against a call that is merely listening sends none, since
    /// telling a silent model to stop steers the answer it has not given yet.
    /// Pressed while a press's session is still opening, it cancels that
    /// press's unmute, so the session opens muted.
    public func stopSpeaking() async {
        pressHeld = false
        if opening != nil { return }
        guard let peer, peer.standing else { return }
        if lukeSpeaking { session?.stopSpeaking() }
        _ = await peer.mute()
        armIdle()
    }

    /// The hang-up, taken when the screen goes or the voice changes. The
    /// hang-up is the service socket's: `session.close` goes as the one Live
    /// client event the route forwards from a device (`SESSIONS_CLIENT_EVENTS`
    /// in `frames.ts`), the session answers `session.closed` on the data
    /// channel, and the peer tears itself down on it. The data channel carries
    /// only the microphone switch — and the peer's own close where the
    /// service's never came back inside the guide's bound, or where no socket
    /// stands to carry it, as `live-call.ts` falls back the other way. A
    /// session the service has created but the peer has not yet heard start
    /// has no channel for `session.closed` to come back on, so the frame is
    /// waited onto the wire instead and the peer torn down at once.
    public func hangUp() async {
        pressHeld = false
        if let hangingUp { return await hangingUp.value }
        guard let peer, !closing, peer.standing else { return }
        let hangingUp = Task { await close(peer) }
        self.hangingUp = hangingUp
        await hangingUp.value
    }

    private func close(_ peer: LivePeer) async {
        closing = true
        refreshStatus()
        if let session {
            session.hangUp()
            if peer.status == .connecting {
                await awaitFlush(of: session)
            } else {
                _ = await peerEnded.value(orAfter: seams.sessionCloseTimeout, fallback: false)
            }
        }
        if peer.standing { _ = await peer.close() }
        endCall(of: peer, final: .idle)
    }

    /// The hang-up on the wire, or the close bound passed: a session in a
    /// reattach gap holds the frame for the connection that comes after it,
    /// which may take the whole cadence to come or never come.
    private func awaitFlush(of session: any LiveSessionSideband) async {
        let flushed = Settlement<Bool>()
        Task {
            await session.settleSends()
            flushed.settle(true)
        }
        _ = await flushed.value(orAfter: seams.sessionCloseTimeout, fallback: false)
    }

    // MARK: - The open

    /// The session standing or coming up, or a new one opened now. One
    /// opening at a time: a second press while the first is still negotiating
    /// waits for it rather than offering the service a second peer. A press
    /// during a hang-up waits for the hang-up to finish and opens anew, as the
    /// Mac's orchestrator lets go of a closing call and opens the next.
    private func ensureSession() async -> LivePeer? {
        if let opening {
            let stood = await opening.value
            return stood ? peer : nil
        }
        if let peer, peer.standing {
            if !closing { return peer }
            await hangingUp?.value
        }
        errorMessage = nil
        refusalNote = nil
        peerEnded = Settlement<Bool>()
        openings += 1
        let thisOpening = openings
        let peer = LivePeer(
            seams: LivePeerSeams(
                makePeerConnection: seams.makePeerConnection,
                openMicrophone: seams.openMicrophone,
                createSession: { [weak self] sdp in await self?.createSession(sdp: sdp, opening: thisOpening) },
                onStatus: { [weak self] status in self?.peerStatusChanged(status) },
                onServerEvent: { [weak self] event in self?.receive(event) },
                onError: { [weak self] message in self?.failed(message) },
                iceGatheringTimeout: seams.iceGatheringTimeout,
                sessionStartTimeout: seams.sessionStartTimeout,
                acknowledgmentTimeout: seams.acknowledgmentTimeout,
                sessionCloseTimeout: seams.sessionCloseTimeout
            )
        )
        self.peer = peer
        let negotiation = Task { [weak self] in
            let stood = await peer.open()
            if self?.peer === peer { self?.opening = nil }
            return stood
        }
        opening = negotiation
        let stood = await negotiation.value
        return stood ? peer : nil
    }

    /// The offer, handed to the service as `session.create` in the synced
    /// voice with an empty seed; the answer is what the peer sets as its remote
    /// description. The call is counted here, when `session.created` lands. A
    /// refusal is remembered in the service's own words, where it has better
    /// ones than the peer's, and answers the peer with nothing.
    private func createSession(sdp: String, opening: Int) async -> LiveSessionCreated? {
        let voice = seams.voice()
        switch await seams.createSession(sdp, voice) {
        case .opened(let session):
            // A hang-up that landed while the service was answering has already
            // ended the peer this offer was for, and a newer press may hold a
            // peer of its own: the session the service created is not adopted
            // but ended the way a standing one is, by `session.close` over its
            // own socket, so no exchange is left standing until it expires.
            guard opening == openings, let peer, peer.standing, !closing else {
                session.hangUp()
                Task {
                    await session.settleSends()
                    session.close()
                }
                return nil
            }
            self.session = session
            listen(to: session)
            seams.onCallStarted()
            return session.created
        case .refused(let refusal):
            refusalNote = Self.note(for: refusal)
            return nil
        }
    }

    /// The service's word on a refusal, where it says more than the peer's
    /// `sessionRefused`: no account behind the bearer, or the hosted tier
    /// refusing. A quota refusal shows the allowance where the service said
    /// it. Every other refusal leaves the peer's own word standing.
    static func note(for refusal: HostedVoiceSessionRefusal) -> String? {
        switch refusal {
        case .notSignedIn:
            voiceKeylessNote
        case .quotaExhausted(let quota):
            quota.map { "\(hostedUnavailableNote) \(allowance($0))" } ?? hostedUnavailableNote
        case .hostedUnavailable:
            hostedUnavailableNote
        case .httpError, .refused, .networkError, .malformedResponse:
            nil
        }
    }

    /// The allowance as the service counts it and the instant it resets.
    static func allowance(_ quota: HostedQuota) -> String {
        let resets = Date(timeIntervalSince1970: quota.resetsAt / 1000)
        return "Your allowance is spent (\(Int(quota.used)) of \(Int(quota.limit))); it resets \(resets.formatted(date: .abbreviated, time: .shortened))."
    }

    /// Everything the session tells the phone. The relayed Live events are
    /// read off the data channel instead; the service's word that a proactive
    /// turn was spoken is activity on the session; and the socket's end for
    /// good is the session's end.
    private func listen(to session: any LiveSessionSideband) {
        sessionReader = Task { [weak self] in
            for await event in session.events {
                guard let self else { return }
                switch event {
                case .live:
                    break
                case .spoken:
                    noteActivity()
                case .closed:
                    sidebandClosed()
                    return
                }
            }
        }
    }

    /// The sessions socket ended for good: the session closed, in which case
    /// the peer has seen or is about to see `session.closed` on its channel,
    /// or every try at re-attaching failed, in which case nothing can end the
    /// session gracefully for the phone any more and the peer closes it
    /// itself, as the desktop's peer does on the host's word that its session
    /// is gone.
    private func sidebandClosed() {
        guard let peer, peer.standing, !closing else { return }
        closing = true
        refreshStatus()
        hangingUp = Task {
            _ = await peer.close()
            endCall(of: peer, final: .idle)
        }
    }

    // MARK: - The channel

    private func receive(_ event: LiveServerEvent) {
        switch event {
        case .sessionStarted:
            armIdle()
        case .inputTranscriptDelta(let delta):
            ledger.append(.user, delta)
            noteActivity()
            publishCaptions()
        case .outputTranscriptDelta(let delta):
            ledger.append(.assistant, delta)
            noteActivity()
            heardLuke()
            publishCaptions()
        case .sessionClosed, .inputAudioMuted, .inputAudioUnmuted, .usageUpdated, .error, .info:
            break
        }
    }

    /// Luke's words arriving: the one source of the speaking status on a phone
    /// that reads no level off his track, held through his pauses.
    private func heardLuke() {
        speakingHangover?.cancel()
        speakingHangover = Task { [weak self, hangover = seams.speakingHangover] in
            try? await Task.sleep(for: hangover)
            guard !Task.isCancelled, let self else { return }
            speakingHangover = nil
            lukeSpeaking = false
            refreshStatus()
        }
        guard !lukeSpeaking else { return }
        lukeSpeaking = true
        refreshStatus()
    }

    private func publishCaptions() {
        captions = ledger.rows
        captionTick?.cancel()
        captionTick = nil
        guard ledger.unsettled else { return }
        captionTick = Task { [weak self, tick = seams.captionSettleTick] in
            try? await Task.sleep(for: tick)
            guard !Task.isCancelled, let self else { return }
            publishCaptions()
        }
    }

    // MARK: - Idle

    /// Either speaker heard, or the microphone switched: the idle window starts over, and an idle already reported is taken back.
    private func noteActivity() {
        guard standing else { return }
        if idleReported {
            idleReported = false
            session?.reportActivity(idle: false)
        }
        armIdle()
    }

    private func armIdle() {
        idleTimer?.cancel()
        idleTimer = Task { [weak self, window = seams.idleWindow, sleep = seams.idleSleep] in
            try? await sleep(window)
            guard !Task.isCancelled, let self, standing, !idleReported else { return }
            idleReported = true
            session?.reportActivity(idle: true)
        }
    }

    // MARK: - State

    private func peerStatusChanged(_ status: LiveStatus) {
        switch status {
        case .idle, .failed:
            if let peer { endCall(of: peer, final: status) }
        case .unavailable, .connecting, .muted, .listening, .speaking, .closing:
            refreshStatus()
        }
    }

    private func failed(_ message: String) {
        errorMessage = refusalNote ?? message
        refusalNote = nil
    }

    private func refreshStatus() {
        guard let peer else { return }
        if closing {
            status = .closing
            return
        }
        switch peer.status {
        case .muted, .listening:
            status = lukeSpeaking ? .speaking : peer.status
        case .unavailable, .idle, .connecting, .speaking, .closing, .failed:
            status = peer.status
        }
    }

    /// Every end of the call, however it came: the timers go, the socket is
    /// let go of, the captions are cleared as the desktop clears its rows, and
    /// the status is the peer's last word. Named for the peer it ends, so a
    /// hang-up finishing behind a peer that already ended on its own does not
    /// end whatever a newer press has opened since.
    private func endCall(of ended: LivePeer, final: LiveStatus) {
        guard peer === ended else { return }
        idleTimer?.cancel()
        idleTimer = nil
        speakingHangover?.cancel()
        speakingHangover = nil
        captionTick?.cancel()
        captionTick = nil
        sessionReader?.cancel()
        sessionReader = nil
        session?.close()
        session = nil
        peer = nil
        opening = nil
        hangingUp = nil
        closing = false
        lukeSpeaking = false
        idleReported = false
        ledger = LiveCaptions(now: seams.now)
        captions = []
        status = final
        peerEnded.settle(true)
    }
}
