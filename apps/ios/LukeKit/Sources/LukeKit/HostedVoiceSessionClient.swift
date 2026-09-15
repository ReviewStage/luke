import Foundation

/// The phone's `HostedLiveSessionSource`
/// (`packages/voice/src/live-session-source.ts`), and the watch's client of
/// the same service: the signed-in account's voice sessions through Luke's
/// own service, over the sockets `packages/hosted/src/live-contract.ts`
/// declares. The service holds the GPT Live key, creates the session at
/// OpenAI, and runs the exchange. On the sessions route what the phone holds
/// is the WebRTC peer (H1) and this socket, which carries the offer out, the
/// answer back, the relayed Live events, and the four frames of the service's
/// own vocabulary the phone may send. On the audio route the watch, which has
/// no WebRTC, holds this socket alone: the service opens the session's
/// primary socket to OpenAI itself and the watch's PCM goes up and Luke's
/// comes down over this one connection, beside the same events and reports.
/// Nothing here appends to a session, and no frame of a device's composing
/// carries instruction text: both routes refuse it
/// (`apps/web/server/voice/frames.ts`).

/// Why no session was opened, named as the desktop's `LIVE_SESSION_OUTCOME`
/// names its failed attempts and by nothing the attempt carried.
public enum HostedVoiceSessionRefusal: Equatable, Sendable {
    /// No account, no usable token, or a token the service refused twice.
    case notSignedIn
    /// The account's allowance is spent; the quota rides where the service said it.
    case quotaExhausted(HostedQuota?)
    /// The service could not answer: a 503, a socket closed or silent before it answered, or a named unavailability.
    case hostedUnavailable
    /// The upgrade was refused by a status this build reads no further meaning into.
    case httpError(status: Int)
    /// The service answered a refusal this build reads no further meaning into.
    case refused(HostedAPIError)
    /// The attempt ended in the transport before any status came back.
    case networkError
    /// The first frame was neither the answer nor a refusal.
    case malformedResponse
}

/// What the client answered a creation on the sessions route with.
public enum HostedVoiceSessionOpening {
    case opened(HostedVoiceSession)
    case refused(HostedVoiceSessionRefusal)
}

/// What the client answered a creation on the audio route with.
public enum HostedAudioSessionOpening {
    case opened(HostedAudioSession)
    case refused(HostedVoiceSessionRefusal)
}

/// What a standing session tells its one consumer, in arrival order.
public enum HostedVoiceSessionEvent: Equatable, Sendable {
    /// A Live server event the service relayed as the session emitted it;
    /// on the audio route, Luke's audio among them.
    case live(LiveServerEventFrame)
    /// The service's own word that a proactive turn was spoken to its end.
    case spoken(ProactiveSpeechKind)
    /// The session's socket ended for good: the session closed, the device
    /// hung up, the function the audio route's socket stood on reached its
    /// end, or every try at re-attaching a lost sessions-route connection
    /// failed. The code is the close frame's where one arrived. Nothing
    /// follows it.
    case closed(code: Int?)
}

/// The sleep the client waits with, injected so a test drives the reattach
/// cadence without waiting on it. It must return or throw promptly when the
/// task awaiting it is cancelled, as `Task.sleep` does, since the deadline
/// race cancels whichever side lost.
public typealias VoiceSleep = @Sendable (Duration) async throws -> Void

/// A refused upgrade, thrown through `authorized` so a 401 renews the bearer and retries once.
private struct UpgradeRefused: Error, HostedUnauthorizedSignaling {
    let status: Int
    var isUnauthorized: Bool { status == HTTPStatus.unauthorized }
}

/// The statuses the client reads a meaning into, as `@sidecar/wire`'s `HTTP_STATUS` names them.
private enum HTTPStatus {
    static let unauthorized = 401
    static let tooManyRequests = 429
    static let serviceUnavailable = 503
}

/// One attempt at standing a fresh connection on a session that already exists.
private enum ReattachAttempt {
    case attached(any VoiceSocket)
    /// The transport did not carry the attempt to an answer; another try may.
    case failed
    /// The service answered, and the answer was not the attachment; no further try is made.
    case refused
}

@MainActor
public final class HostedVoiceSessionClient {
    private let sessionsURL: URL
    private let audioURL: URL
    private let session: any AccountTokenProviding
    private let deviceId: @MainActor () -> String?
    private let opener: any VoiceSocketOpener
    private let requestTimeout: Duration
    private let reattachDelays: [Duration]
    private let sleep: VoiceSleep

    /// - Parameters:
    ///   - serviceURL: The hosted service origin; a socket opens at
    ///     `VoiceServiceContract.sessionsPath` or `audioPath` under it with the scheme swapped for its socket form.
    ///   - session: The account whose bearer every handshake carries, read fresh per attempt.
    ///   - deviceId: This installation's device row id as `DeviceRegistrar` holds it, read at each creation.
    ///   - opener: The socket seam.
    ///   - requestTimeout: How long a handshake or a first frame may take before the attempt is lost.
    ///   - reattachDelays: The waits before each try at re-attaching a lost connection.
    ///   - sleep: The wait itself.
    public init(
        serviceURL: URL,
        session: any AccountTokenProviding,
        deviceId: @escaping @MainActor () -> String?,
        opener: any VoiceSocketOpener = URLSessionVoiceSocketOpener(),
        requestTimeout: Duration = .seconds(10),
        reattachDelays: [Duration] = VoiceServiceContract.reattachDelaysMs.map { .milliseconds($0) },
        sleep: @escaping VoiceSleep = { try await Task.sleep(for: $0) }
    ) {
        sessionsURL = Self.sessionsURL(serviceURL: serviceURL)
        audioURL = Self.audioURL(serviceURL: serviceURL)
        self.session = session
        self.deviceId = deviceId
        self.opener = opener
        self.requestTimeout = requestTimeout
        self.reattachDelays = reattachDelays
        self.sleep = sleep
    }

    /// The sessions socket address under the service origin: `https` becomes
    /// `wss` and `http` becomes `ws`, the way `webSocketOrigin` swaps them.
    static func sessionsURL(serviceURL: URL) -> URL {
        socketURL(serviceURL: serviceURL, path: VoiceServiceContract.sessionsPath)
    }

    /// The audio socket address under the service origin, on the same terms.
    static func audioURL(serviceURL: URL) -> URL {
        socketURL(serviceURL: serviceURL, path: VoiceServiceContract.audioPath)
    }

    private static func socketURL(serviceURL: URL, path: String) -> URL {
        var components = URLComponents(url: serviceURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        components.path = "/" + path
        components.query = nil
        components.fragment = nil
        return components.url ?? serviceURL
    }

    /// One session for this offer. The socket opens with the bearer and the
    /// device row on its handshake, `session.create` goes as the first frame,
    /// and `session.created` is the first frame back; the socket that answered
    /// is the session's, and stays its sideband across the service's own
    /// recycles. A refused bearer is renewed once and retried once under the
    /// same holder, as every hosted call on the phone is.
    public func create(sdpOffer: String, voice: LiveVoice) async -> HostedVoiceSessionOpening {
        let socket: any VoiceSocket
        switch await openCreating(at: sessionsURL) {
        case .opened(let opened): socket = opened
        case .refused(let refusal): return .refused(refusal)
        }
        let frame = VoiceServiceOutgoingFrame.create(SessionCreateFrame(sdp: sdpOffer, voice: voice))
        switch await firstFrame(on: socket, after: frame, route: .sessions) {
        case .frame(.created(let created)):
            // The session holds the client it re-attaches through: a caller that
            // keeps only the session must still get its connection back.
            return .opened(
                HostedVoiceSession(
                    created: created, socket: socket, attach: { await self.attachOnce(sessionId: $0) },
                    delays: reattachDelays, sleep: sleep
                )
            )
        case .frame(.refused(let reason, let quota)):
            socket.close()
            return .refused(Self.refusal(reason: reason, quota: quota))
        case .frame:
            socket.close()
            return .refused(.malformedResponse)
        case .closed, .silent:
            socket.close()
            return .refused(.hostedUnavailable)
        }
    }

    /// One session on the audio route, for a device that streams its audio
    /// through the service: the same handshake as `create`, `session.create`
    /// naming the voice and the format as the first frame, and the audio
    /// route's `session.created` as the first frame back. The socket that
    /// answered is the session's for as long as the service's function
    /// invocation stands, and no longer: a primary socket has no attach, so
    /// the session ends with its one connection.
    public func createAudio(voice: LiveVoice, format: LiveAudioFormat = .default) async -> HostedAudioSessionOpening {
        let socket: any VoiceSocket
        switch await openCreating(at: audioURL) {
        case .opened(let opened): socket = opened
        case .refused(let refusal): return .refused(refusal)
        }
        let frame = VoiceServiceOutgoingFrame.createAudio(SessionAudioCreateFrame(voice: voice, format: format))
        switch await firstFrame(on: socket, after: frame, route: .audio) {
        case .frame(.audioCreated(let created)):
            return .opened(HostedAudioSession(created: created, format: format, socket: socket))
        case .frame(.refused(let reason, let quota)):
            socket.close()
            return .refused(Self.refusal(reason: reason, quota: quota))
        case .frame:
            socket.close()
            return .refused(.malformedResponse)
        case .closed, .silent:
            socket.close()
            return .refused(.hostedUnavailable)
        }
    }

    private enum CreatingSocket {
        case opened(any VoiceSocket)
        case refused(HostedVoiceSessionRefusal)
    }

    /// The socket a creation opens on either route: under the bearer and the
    /// device row on its handshake, with a refused bearer renewed once and
    /// retried once under the same holder, as every hosted call on a device is.
    private func openCreating(at url: URL) async -> CreatingSocket {
        let deviceId = deviceId()
        do {
            return .opened(
                try await session.authorized { token in
                    try await self.openSocket(url: url, headers: VoiceHandshakeHeaders(bearer: token, deviceId: deviceId))
                }
            )
        } catch let refused as UpgradeRefused {
            return .refused(Self.refusal(status: refused.status))
        } catch is AccountSessionError {
            return .refused(.notSignedIn)
        } catch let opening as OpenFailure {
            return .refused(opening.refusal)
        } catch {
            return .refused(.networkError)
        }
    }

    /// A socket that would not open, carried out of `authorized` as the refusal it reads as.
    private struct OpenFailure: Error {
        let refusal: HostedVoiceSessionRefusal
    }

    /// Opens one socket under the headers given and waits for its handshake to
    /// settle within the request deadline. A 401 is thrown as `UpgradeRefused`
    /// so the caller's `authorized` renews and retries; every other end is the
    /// refusal it names.
    private func openSocket(url: URL, headers: VoiceHandshakeHeaders) async throws -> any VoiceSocket {
        let socket = opener.socket(url: url, headers: headers)
        guard let opening = await within(requestTimeout, { await socket.open() }) else {
            socket.close()
            throw OpenFailure(refusal: .hostedUnavailable)
        }
        switch opening {
        case .opened:
            return socket
        case .refused(let status):
            socket.close()
            if status == HTTPStatus.unauthorized { throw UpgradeRefused(status: status) }
            throw OpenFailure(refusal: Self.refusal(status: status))
        case .failed:
            socket.close()
            throw OpenFailure(refusal: .networkError)
        }
    }

    private enum FirstFrame {
        case frame(VoiceServiceIncomingFrame)
        case closed
        case silent
    }

    /// Sends the request frame and takes the service's one answer, read as the
    /// route answers it, or the close or silence that came instead of it,
    /// within the request deadline.
    private func firstFrame(
        on socket: any VoiceSocket, after request: VoiceServiceOutgoingFrame, route: VoiceServiceRoute
    ) async -> FirstFrame {
        do {
            try await socket.send(request.text)
        } catch {
            return .closed
        }
        guard let arrival = await within(requestTimeout, { await socket.receive() }) else { return .silent }
        switch arrival {
        case .frame(let text): return .frame(VoiceServiceIncomingFrame(text: text, route: route))
        case .closed: return .closed
        }
    }

    /// One attempt to stand a fresh connection on a session that already
    /// exists: a new socket under the current bearer alone, since the session
    /// already names its device, `session.attach` as its first frame, and the
    /// service's `session.attached` for the same id as the answer. A socket
    /// that would not open or went quiet is a transport failure worth another
    /// try; a frame that is not the answer, or a bearer the service refused, is
    /// the service's decision and ends the attempts.
    private func attachOnce(sessionId: String) async -> ReattachAttempt {
        guard let token = try? await session.validAccessToken() else { return .refused }
        let socket = opener.socket(url: sessionsURL, headers: VoiceHandshakeHeaders(bearer: token, deviceId: nil))
        guard let opening = await within(requestTimeout, { await socket.open() }) else {
            socket.close()
            return .failed
        }
        switch opening {
        case .opened:
            break
        case .refused(let status):
            socket.close()
            return status == HTTPStatus.unauthorized ? .refused : .failed
        case .failed:
            socket.close()
            return .failed
        }
        switch await firstFrame(on: socket, after: .attach(SessionAttachFrame(sessionId: sessionId)), route: .sessions) {
        case .frame(.attached(let attached)) where attached.sessionId == sessionId:
            return .attached(socket)
        case .frame(.unreadable), .closed, .silent:
            socket.close()
            return .failed
        case .frame:
            socket.close()
            return .refused
        }
    }

    /// The operation's answer, or nothing where the deadline passed first; the
    /// loser of the race is cancelled.
    private func within<Answer: Sendable>(
        _ deadline: Duration, _ operation: @escaping @Sendable () async -> Answer
    ) async -> Answer? {
        let sleep = sleep
        return await withTaskGroup(of: Answer?.self) { group in
            group.addTask { await operation() }
            group.addTask {
                try? await sleep(deadline)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// The refusal an upgrade status reads as, `statusOutcome` on the desktop.
    private static func refusal(status: Int) -> HostedVoiceSessionRefusal {
        switch status {
        case HTTPStatus.unauthorized: .notSignedIn
        case HTTPStatus.tooManyRequests: .quotaExhausted(nil)
        case HTTPStatus.serviceUnavailable: .hostedUnavailable
        default: .httpError(status: status)
        }
    }

    /// The refusal a hosted error frame reads as, `HOSTED_ERROR_OUTCOME` on the desktop.
    private static func refusal(reason: HostedAPIError, quota: HostedQuota?) -> HostedVoiceSessionRefusal {
        switch reason {
        case .invalidToken: .notSignedIn
        case .quotaExhausted: .quotaExhausted(quota)
        case .unavailable, .upstreamThrottled: .hostedUnavailable
        default: .refused(reason)
        }
    }
}

/// A session that stands: the answer the service gave, the events it relays,
/// and the frames the phone may send it. The socket underneath is replaced
/// whenever it closes for any reason but the session's own end — the
/// service's function invocation ends under a standing WebRTC session, and
/// the connection to it with it — with a fresh one opened by `session.attach`
/// on the reattach schedule. What the session said in the gap is lost, as it
/// is on the desktop; sends made in the gap are held and sent on the next
/// connection, the last-reported idle first and any activity report made in
/// the gap dropped in its favour, since the standing report already says the
/// latest. Only when every try fails, the service refuses the attachment, or
/// the phone hangs up meanwhile does the close reach the consumer.
@MainActor
public final class HostedVoiceSession {
    public let sessionId: String
    public let sdpAnswer: String
    /// The allowance the session was spent against, where the service said.
    public let quota: HostedQuota?

    /// The answer as `LivePeerSeams.createSession` hands it to the peer: the id and the SDP answer to set as the remote description.
    public var created: LiveSessionCreated { LiveSessionCreated(sessionId: sessionId, sdpAnswer: sdpAnswer) }

    /// Everything the session tells the phone, ending with `closed`. Held from
    /// the session's making, so nothing said before the consumer comes is lost.
    public let events: AsyncStream<HostedVoiceSessionEvent>

    private let continuation: AsyncStream<HostedVoiceSessionEvent>.Continuation
    private var socket: any VoiceSocket
    private let attach: @MainActor (String) async -> ReattachAttempt
    private let delays: [Duration]
    private let sleep: VoiceSleep
    /// Sends made while no connection stands, sent on the next one.
    private var heldSends: [VoiceServiceOutgoingFrame]?
    /// The peer's idle as last reported, told again to every connection that stands anew.
    private var standingActivity: SessionActivityFrame?
    private var closedByClient = false
    private var sendChain: Task<Void, Never>?
    /// Whoever is waiting for the sends held through a gap to reach a connection, or for the session to give up on one.
    private var flushWaiters: [CheckedContinuation<Void, Never>] = []
    private var reader: Task<Void, Never>?

    fileprivate init(
        created: SessionCreatedFrame,
        socket: any VoiceSocket,
        attach: @escaping @MainActor (String) async -> ReattachAttempt,
        delays: [Duration],
        sleep: @escaping VoiceSleep
    ) {
        sessionId = created.sessionId
        sdpAnswer = created.sdpAnswer
        quota = created.quota
        self.socket = socket
        self.attach = attach
        self.delays = delays
        self.sleep = sleep
        var continuation: AsyncStream<HostedVoiceSessionEvent>.Continuation!
        events = AsyncStream(bufferingPolicy: .unbounded) { continuation = $0 }
        self.continuation = continuation
        reader = Task { [weak self] in await Self.serve(weak: self) }
    }

    /// A session dropped without a hang-up lets its connection go rather than
    /// holding it until the service closes it; the reader never keeps the
    /// session alive across a wait, so this runs as soon as the owner lets go.
    deinit {
        socket.close()
        reader?.cancel()
        continuation.finish()
    }

    /// Tells the service whether the peer has gone quiet, in the service's own
    /// vocabulary. The peer reports its transitions; the report last made
    /// stands for the session and is told first to each connection that
    /// stands anew.
    public func reportActivity(idle: Bool) {
        let frame = SessionActivityFrame(idle: idle)
        standingActivity = frame
        send(.activity(frame))
    }

    /// The stop key: asks the service to tell the model to stop and wait. Held
    /// through a gap and sent on the next connection, since the model keeps
    /// speaking across the service's own recycle.
    public func stopSpeaking() {
        send(.stop)
    }

    /// The hang-up: the one Live client event the route forwards. The session
    /// answers `session.closed` among its events and the service then ends the
    /// socket normally, which is what `closed` reports.
    public func hangUp() {
        send(.liveClose)
    }

    /// Ends the socket without a word to the session: what the phone does when
    /// the session is already over, or when it will not wait for it to be. A
    /// try at re-attaching in flight is abandoned, and one that lands after is
    /// closed.
    public func close() {
        guard !closedByClient else { return }
        closedByClient = true
        heldSends = nil
        socket.close()
        reader?.cancel()
        resumeFlushWaiters()
    }

    /// Awaits every send queued so far: what a caller about to `close()` the
    /// socket waits on, so a hang-up it just sent is on the wire before the
    /// socket goes, and what a test reads the socket after. A send made in a
    /// gap is held for the connection that comes after it, so this waits for
    /// that connection to stand and carry it, or for the session to give up
    /// on one; a caller with a bound of its own races this against it.
    public func settleSends() async {
        if heldSends != nil {
            await withCheckedContinuation { flushWaiters.append($0) }
        }
        await sendChain?.value
    }

    private func resumeFlushWaiters() {
        let waiting = flushWaiters
        flushWaiters = []
        for waiter in waiting { waiter.resume() }
    }

    private func send(_ frame: VoiceServiceOutgoingFrame) {
        guard !closedByClient else { return }
        if heldSends != nil {
            heldSends?.append(frame)
            return
        }
        enqueue(frame.text, on: socket)
    }

    /// Sends ride one queue so a stop cannot overtake the report before it.
    private func enqueue(_ text: String, on socket: any VoiceSocket) {
        let preceding = sendChain
        sendChain = Task {
            await preceding?.value
            try? await socket.send(text)
        }
    }

    /// Reads each connection to its end and stands the next one up, until the
    /// session ends, the phone hangs up, or the session is dropped. The
    /// session is held only between waits: the wait on the socket is the long
    /// one, and it runs on the socket alone, so a session nobody holds any
    /// more is freed and its `deinit` closes the socket the wait stands on.
    /// The loop ends on an arrival and never on cancellation alone: a hang-up
    /// closes the socket and cancels this task in one breath, and a reader
    /// that left between two waits would leave the close unread and the
    /// consumer never told.
    private static func serve(weak session: HostedVoiceSession?) async {
        weak var session = session
        while true {
            guard let socket = session?.socket else { return }
            let arrival = await socket.receive()
            guard let standing = session else {
                socket.close()
                return
            }
            switch arrival {
            case .frame(let text):
                standing.hear(text)
            case .closed(let code):
                guard await standing.recovered(from: code) else { return }
            }
        }
    }

    /// One frame the service sent, handed up as what it is.
    private func hear(_ text: String) {
        switch VoiceServiceIncomingFrame(text: text, route: .sessions) {
        case .liveEvent(let event): continuation.yield(.live(event))
        case .spoken(let kind): continuation.yield(.spoken(kind))
        case .created, .audioCreated, .attached, .refused, .unreadable: break
        }
    }

    /// The connection ended with `close`: either the session is over and the
    /// consumer is told, or a fresh connection now stands in its place and the
    /// sends held meanwhile are on it. Answers whether reading goes on.
    private func recovered(from close: Int?) async -> Bool {
        // The connection that ended is let go however it ended, so nothing of it outlives its close.
        socket.close()
        if closedByClient || Task.isCancelled || close == normalSocketCloseCode {
            finish(code: close)
            return false
        }
        heldSends = []
        guard let recovered = await recover() else {
            finish(code: close)
            return false
        }
        socket = recovered
        let pending = (heldSends ?? []).filter { frame in
            if case .activity = frame { return false }
            return true
        }
        heldSends = nil
        if let standingActivity { enqueue(VoiceServiceOutgoingFrame.activity(standingActivity).text, on: recovered) }
        for frame in pending { enqueue(frame.text, on: recovered) }
        resumeFlushWaiters()
        return true
    }

    /// The next connection, or nothing where every try failed, the service
    /// refused, or the phone hung up meanwhile. A try that landed the instant
    /// after a hang-up is closed here rather than adopted.
    private func recover() async -> (any VoiceSocket)? {
        for delay in delays {
            if closedByClient || Task.isCancelled { return nil }
            do {
                try await sleep(delay)
            } catch {
                return nil
            }
            // A hang-up that ended the wait opens no further attempt.
            if closedByClient || Task.isCancelled { return nil }
            switch await attach(sessionId) {
            case .attached(let socket):
                if closedByClient || Task.isCancelled {
                    socket.close()
                    return nil
                }
                return socket
            case .refused:
                return nil
            case .failed:
                continue
            }
        }
        return nil
    }

    private func finish(code: Int?) {
        heldSends = nil
        resumeFlushWaiters()
        continuation.yield(.closed(code: code))
        continuation.finish()
    }
}

/// A session on the audio route that stands: the answer the service gave, the
/// events it relays — Luke's audio among them — and the frames the device may
/// send it, its own audio first. The socket underneath is the session's one
/// connection: a primary socket at OpenAI has no attach, so when the
/// service's function invocation ends, or the network drops the connection,
/// the session is over and `closed` reaches the consumer at once, with
/// nothing tried again. The next press opens a new session.
@MainActor
public final class HostedAudioSession {
    public let sessionId: String
    /// The allowance the session was spent against, where the service said.
    public let quota: HostedQuota?
    /// The format the session was created under, which is the format of every sample sent and received.
    public let format: LiveAudioFormat

    /// Everything the session tells the device, ending with `closed`. Held
    /// from the session's making, so nothing said before the consumer comes
    /// is lost.
    public let events: AsyncStream<HostedVoiceSessionEvent>

    private let continuation: AsyncStream<HostedVoiceSessionEvent>.Continuation
    private let socket: any VoiceSocket
    private var closedByClient = false
    private var finished = false
    private var sendChain: Task<Void, Never>?
    private var reader: Task<Void, Never>?

    fileprivate init(created: SessionAudioCreatedFrame, format: LiveAudioFormat, socket: any VoiceSocket) {
        sessionId = created.sessionId
        quota = created.quota
        self.format = format
        self.socket = socket
        var continuation: AsyncStream<HostedVoiceSessionEvent>.Continuation!
        events = AsyncStream(bufferingPolicy: .unbounded) { continuation = $0 }
        self.continuation = continuation
        reader = Task { [weak self] in await Self.serve(weak: self) }
    }

    /// A session dropped without a hang-up lets its connection go rather than
    /// holding it until the service closes it; the reader never keeps the
    /// session alive across a wait, so this runs as soon as the owner lets go.
    deinit {
        socket.close()
        reader?.cancel()
        continuation.finish()
    }

    /// One chunk of the device's own audio, in the session's format, as
    /// `session.input_audio.append`: the one thing this route admits that the
    /// sessions route does not. The guide asks that input keep running
    /// through silence, so a caller sends its silence this way too.
    public func appendAudio(_ samples: [Int16]) {
        guard !samples.isEmpty else { return }
        send(.inputAudio(base64: PCM16Audio.base64(samples)))
    }

    /// Tells the service whether the device has gone quiet, in the service's own vocabulary.
    public func reportActivity(idle: Bool) {
        send(.activity(SessionActivityFrame(idle: idle)))
    }

    /// The stop control: asks the service to tell the model to stop and wait.
    public func stopSpeaking() {
        send(.stop)
    }

    /// The hang-up: the one Live client event the route forwards. The session
    /// answers `session.closed` among its events and the service then ends the
    /// socket normally, which is what `closed` reports.
    public func hangUp() {
        send(.liveClose)
    }

    /// Ends the socket without a word to the session: what the device does
    /// when the session is already over, or when it will not wait for it to
    /// be. The consumer is told `closed` here rather than by the reader, which
    /// the cancellation may catch between two waits with the close unread.
    public func close() {
        guard !closedByClient else { return }
        closedByClient = true
        reader?.cancel()
        finish(code: nil)
    }

    /// Awaits every send queued so far; for a hang-up that waits its frame onto the wire, and for a test that reads what the socket was sent.
    public func settleSends() async {
        await sendChain?.value
    }

    private func send(_ frame: VoiceServiceOutgoingFrame) {
        guard !closedByClient, !finished else { return }
        let text = frame.text
        let preceding = sendChain
        let socket = socket
        // Sends ride one queue so a stop cannot overtake the audio before it.
        sendChain = Task {
            await preceding?.value
            try? await socket.send(text)
        }
    }

    /// Reads the one connection to its end. The session is held only between
    /// waits, so a session nobody holds any more is freed and its `deinit`
    /// closes the socket the wait stands on; the loop ends on an arrival, as
    /// the sessions route's does, never on cancellation alone.
    private static func serve(weak session: HostedAudioSession?) async {
        weak var session = session
        while true {
            guard let socket = session?.socket else { return }
            let arrival = await socket.receive()
            guard let standing = session else {
                socket.close()
                return
            }
            switch arrival {
            case .frame(let text):
                standing.hear(text)
            case .closed(let code):
                standing.finish(code: code)
                return
            }
        }
    }

    private func hear(_ text: String) {
        switch VoiceServiceIncomingFrame(text: text, route: .audio) {
        case .liveEvent(let event): continuation.yield(.live(event))
        case .spoken(let kind): continuation.yield(.spoken(kind))
        case .created, .audioCreated, .attached, .refused, .unreadable: break
        }
    }

    /// The connection ended, however it ended: the socket is let go so nothing of it outlives its close, and the consumer is told once.
    private func finish(code: Int?) {
        guard !finished else { return }
        finished = true
        socket.close()
        continuation.yield(.closed(code: code))
        continuation.finish()
    }
}
