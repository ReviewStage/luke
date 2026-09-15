import Foundation

// The phone's counterpart of the desktop's `live-peer.ts` and the peer half
// of its `live-call.ts`: a GPT Live WebRTC peer built in the guide's order —
// the microphone's track on the one sending line, the `oai-events` data
// channel created before the offer, ICE gathered under a bound, the offer
// handed to whoever creates the session, the answer applied — and then driven
// through the only three events an untrusted peer may send: the microphone
// switch and the hang-up. The peer is written over the narrowest slice of
// WebRTC it touches, so the tests stand a fake in for each and the one file
// that imports the binary (`WebRTCPeer.swift`) stays thin.
//
// The line always carries a track. GPT Live is full duplex and paces its
// output against the input timeline, and the conversations guide asks that
// input audio keep running through silence: on WebRTC, that the negotiated
// input track stay active. Press-to-talk is therefore enabling and disabling
// the one microphone track, never swapping it out: a disabled track is
// encoded as silence and keeps the timeline running, where a sender with no
// track stalls it. The desktop synthesizes its silence so the system's
// microphone indicator answers to the key alone; here the capture is WebRTC's
// own audio device module, which holds the device for as long as the peer
// stands.

/// A session description as the peer's slice of WebRTC hands it: the type
/// and the SDP of an `RTCSessionDescription`.
public struct LiveSessionDescription: Equatable, Sendable {
    public enum Kind: String, Sendable {
        case offer
        case prAnswer = "pranswer"
        case answer
        case rollback
    }

    public let kind: Kind
    public let sdp: String

    public init(kind: Kind, sdp: String) {
        self.kind = kind
        self.sdp = sdp
    }
}

/// What the service answered a `session.create` with — `LiveSessionCreated`
/// in `packages/hosted/src/live-contract.ts`: the session's opaque id,
/// preserved unchanged, and the SDP answer to set as the remote description.
public struct LiveSessionCreated: Equatable, Sendable {
    public let sessionId: String
    public let sdpAnswer: String

    public init(sessionId: String, sdpAnswer: String) {
        self.sessionId = sessionId
        self.sdpAnswer = sdpAnswer
    }
}

/// The peer connection's state as the desktop reports it to its host —
/// `LIVE_TRANSPORT_STATE` in `packages/gateway/src/protocol.ts`:
/// `RTCPeerConnectionState` minus `new`, which that report's schema drops too.
public enum LiveTransportState: String, Sendable {
    case connecting
    case connected
    case disconnected
    case failed
    case closed
}

/// How far the voice session has progressed — `LIVE_STATUS` in
/// `packages/live/src/events.ts`. The peer moves through idle, connecting,
/// muted, listening, closing, and failed; speaking is the screen's to read
/// off the remote track's level, and unavailable is its word for a phone
/// with nothing to run on.
public enum LiveStatus: String, Sendable {
    case unavailable
    case idle
    case connecting
    case muted
    case listening
    case speaking
    case closing
    case failed
}

/// The desktop's bounds, kept to the millisecond: how long ICE gathering may
/// run before the offer goes with what it has, how long a created session may
/// take to announce itself started, how long a microphone switch waits for its
/// acknowledgment, and the conversations guide's bound on a graceful close.
public enum LivePeerBounds {
    public static let iceGathering: Duration = .seconds(5)
    public static let sessionStart: Duration = .seconds(15)
    public static let acknowledgment: Duration = .seconds(5)
    public static let sessionClose: Duration = .seconds(15)
}

// MARK: - Seams

/// A local or remote audio track: the one thing the peer does to a track is
/// switch it, and the one thing it reads is whether it is switched on.
@MainActor
public protocol LiveAudioTrack: AnyObject {
    var isEnabled: Bool { get set }
}

/// The `oai-events` channel, as the peer sees it: whether it can carry an
/// event, the send, and the two callbacks the peer installs.
@MainActor
public protocol LiveDataChannel: AnyObject {
    var isOpen: Bool { get }
    /// Hands one event's JSON to the channel; whether the channel took it.
    @discardableResult
    func send(_ text: String) -> Bool
    var onMessage: ((String) -> Void)? { get set }
    var onClose: (() -> Void)? { get set }
}

/// The peer connection, as the peer drives it. Every callback is delivered on
/// the main actor, whatever thread the transport raised it on.
@MainActor
public protocol LivePeerConnection: AnyObject {
    /// The connection's state, or nothing while it is still new.
    var transportState: LiveTransportState? { get }
    var iceGatheringComplete: Bool { get }
    var localDescription: LiveSessionDescription? { get }
    func addAudioTrack(_ track: any LiveAudioTrack) throws
    func createDataChannel(label: String) throws -> any LiveDataChannel
    func createOffer() async throws -> LiveSessionDescription
    func setLocalDescription(_ description: LiveSessionDescription) async throws
    func setRemoteDescription(_ description: LiveSessionDescription) async throws
    func close()
    var onIceGatheringStateChange: (() -> Void)? { get set }
    var onTransportStateChange: (() -> Void)? { get set }
    var onRemoteTrack: ((any LiveAudioTrack) -> Void)? { get set }
}

/// What the peer is built over and reports to. The connection and the
/// microphone are factories, so a test drives the state machine without a
/// device and a phone hands in `WebRTCPeerFactory`'s two; the session is
/// created by whoever holds the key, handed the offer and answering with the
/// session's id and the SDP answer, or nothing for a refusal.
public struct LivePeerSeams: Sendable {
    public var makePeerConnection: @MainActor @Sendable () throws -> any LivePeerConnection
    public var openMicrophone: @MainActor @Sendable () throws -> any LiveAudioTrack
    public var createSession: @MainActor @Sendable (_ sdp: String) async throws -> LiveSessionCreated?
    /// Each status the peer moves to, once.
    public var onStatus: @MainActor @Sendable (LiveStatus) -> Void
    /// Every event the channel carried that the device is shown, decoded, after the peer has read it.
    public var onServerEvent: @MainActor @Sendable (LiveServerEvent) -> Void
    /// Why an open failed, in words the screen can show.
    public var onError: @MainActor @Sendable (String) -> Void
    public var iceGatheringTimeout: Duration
    public var sessionStartTimeout: Duration
    public var acknowledgmentTimeout: Duration
    public var sessionCloseTimeout: Duration

    public init(
        makePeerConnection: @MainActor @Sendable @escaping () throws -> any LivePeerConnection,
        openMicrophone: @MainActor @Sendable @escaping () throws -> any LiveAudioTrack,
        createSession: @MainActor @Sendable @escaping (_ sdp: String) async throws -> LiveSessionCreated?,
        onStatus: @MainActor @Sendable @escaping (LiveStatus) -> Void = { _ in },
        onServerEvent: @MainActor @Sendable @escaping (LiveServerEvent) -> Void = { _ in },
        onError: @MainActor @Sendable @escaping (String) -> Void = { _ in },
        iceGatheringTimeout: Duration = LivePeerBounds.iceGathering,
        sessionStartTimeout: Duration = LivePeerBounds.sessionStart,
        acknowledgmentTimeout: Duration = LivePeerBounds.acknowledgment,
        sessionCloseTimeout: Duration = LivePeerBounds.sessionClose
    ) {
        self.makePeerConnection = makePeerConnection
        self.openMicrophone = openMicrophone
        self.createSession = createSession
        self.onStatus = onStatus
        self.onServerEvent = onServerEvent
        self.onError = onError
        self.iceGatheringTimeout = iceGatheringTimeout
        self.sessionStartTimeout = sessionStartTimeout
        self.acknowledgmentTimeout = acknowledgmentTimeout
        self.sessionCloseTimeout = sessionCloseTimeout
    }
}

/// Why an open failed on the peer's own side, before or beside anything the transport threw.
public enum LivePeerFailure: Error, Equatable, Sendable, LocalizedError {
    case noLocalDescription
    case sessionRefused

    public var errorDescription: String? {
        switch self {
        case .noLocalDescription: "the peer produced no local description"
        case .sessionRefused: "Luke could not open a voice session."
        }
    }
}

// MARK: - LivePeer

/// The one session as a GPT Live peer. It owns the microphone switch and the
/// hang-up and nothing else: it sends the mute, unmute, and close events the
/// data channel permissions allow it, flips the track only on the
/// acknowledgment, reads its own lifecycle off the channel, reports its
/// transport, and hands every event the device is shown to whoever draws the
/// captions. Every append is the service's, over its sideband.
@MainActor
public final class LivePeer {
    /// The label the WebRTC guide gives the event channel; `LIVE_EVENTS_CHANNEL_LABEL` on the desktop.
    public static let eventsChannelLabel = "oai-events"

    private static let sessionStartTimeoutMessage = "The voice session did not start."

    private let seams: LivePeerSeams

    public private(set) var status: LiveStatus = .idle {
        didSet { if status != oldValue { seams.onStatus(status) } }
    }

    /// The session the service created for this peer's offer, so its word about a session can be matched to it.
    public private(set) var sessionId: String?

    /// Luke's track, as the connection handed it up; WebRTC plays it through the device's own output.
    public private(set) var remoteTrack: (any LiveAudioTrack)?

    private var connection: (any LivePeerConnection)?
    private var channel: (any LiveDataChannel)?
    private var microphone: (any LiveAudioTrack)?
    /// The open still negotiating, so a second ask reads its answer rather than opening a peer of its own.
    private var opening: Task<Bool, Never>?
    /// The mute under way, so a press landing before it has settled waits for it.
    private var muting: Task<Bool, Never>?
    /// The ICE gathering still awaited, so an end of the peer ends the wait too.
    private var gathering: Settlement<Bool>?
    private let announcedStart = Settlement<Bool>()
    private let announcedClose = Settlement<Bool>()
    private var pendingSwitch: PendingSwitch?
    private var started = false
    private var ended = false
    private var closing = false
    private var micLive = false
    private var ids = 0

    public init(seams: LivePeerSeams) {
        self.seams = seams
    }

    /// A peer stands from the moment its connection is built until any end.
    public var standing: Bool { connection != nil && !ended }

    public var listening: Bool { standing && micLive }

    /// Opens the peer in the guide's order and waits for the session to
    /// announce itself started; whether it stands. A refusal answers rather
    /// than throws, so the screen can say what went wrong, and whatever was
    /// built is closed. A second open while the first is still negotiating
    /// answers that one; one after it answers whether the peer stands.
    public func open() async -> Bool {
        if let opening { return await opening.value }
        if connection != nil || ended { return standing && started }
        status = .connecting
        do {
            try build()
        } catch {
            seams.onError(error.localizedDescription)
            tearDown(.failed)
            return false
        }
        let negotiation = Task {
            defer { opening = nil }
            return await negotiate()
        }
        opening = negotiation
        return await negotiation.value
    }

    /// The talk key's press: the switch goes, and the track is enabled only
    /// on the acknowledgment. A press landing while a mute is still in flight
    /// waits for it first.
    public func unmute() async -> Bool {
        while let muting = self.muting { _ = await muting.value }
        guard standing, started, microphone != nil else { return false }
        if micLive { return true }
        let acknowledged = await switchMicrophone(.unmute(eventId: nextId()))
        guard acknowledged, standing, let microphone else { return false }
        microphone.isEnabled = true
        micLive = true
        refreshStatus()
        return true
    }

    /// The talk key's release, and the stop: an unmute still waiting on its
    /// acknowledgment is given up first, and the mute goes whatever the track
    /// shows, since the server may still be about to honour the unmute it
    /// was asked for. The track is disabled whatever the answer, because the
    /// key being up is the developer's decision. The answer stays the
    /// session's own word on the switch.
    public func mute() async -> Bool {
        if let muting { return await muting.value }
        guard standing, started else { return false }
        let release = Task {
            defer { muting = nil }
            return await muteAndRelease()
        }
        muting = release
        return await release.value
    }

    /// The graceful hang-up the conversations guide prescribes: `session.close`
    /// goes and everything stays open until `session.closed` arrives or the
    /// bound passes; whether it arrived. A channel that cannot carry the close
    /// leaves the hang-up to the service, whose sideband can still close the
    /// session, so the peer is torn down at once and answers false.
    public func close() async -> Bool {
        guard !ended, !closing, connection != nil || opening != nil else { return false }
        closing = true
        status = .closing
        guard started, let channel, channel.isOpen else {
            tearDown(.idle)
            return false
        }
        send(.close(eventId: nextId()))
        let announced = await announcedClose.value(orAfter: seams.sessionCloseTimeout, fallback: false)
        if !ended { tearDown(.idle) }
        return announced
    }

    // MARK: - Negotiation

    /// Everything the peer is built from, before the first suspension: the
    /// connection, the microphone on its line, and the channel with its
    /// handlers. Built inside `open()` itself, so a hang-up landing while the
    /// negotiation is still to begin always finds the connection it has to
    /// close.
    private func build() throws {
        let connection = try seams.makePeerConnection()
        self.connection = connection
        connection.onRemoteTrack = { [weak self] track in self?.remoteTrack = track }
        connection.onTransportStateChange = { [weak self] in self?.transportChanged() }
        let microphone = try seams.openMicrophone()
        microphone.isEnabled = false
        self.microphone = microphone
        try connection.addAudioTrack(microphone)
        let channel = try connection.createDataChannel(label: Self.eventsChannelLabel)
        self.channel = channel
        channel.onMessage = { [weak self] text in self?.receive(text) }
        channel.onClose = { [weak self] in self?.channelClosed() }
    }

    private func negotiate() async -> Bool {
        guard let connection, !ended else { return false }
        do {
            let offer = try await connection.createOffer()
            guard !ended else { return false }
            try await connection.setLocalDescription(offer)
            guard !ended else { return false }
            await gatherIce(connection)
            guard !ended else { return false }
            guard let sdp = connection.localDescription?.sdp, !sdp.isEmpty else {
                throw LivePeerFailure.noLocalDescription
            }
            guard let created = try await seams.createSession(sdp) else { throw LivePeerFailure.sessionRefused }
            guard !ended else { return false }
            try await connection.setRemoteDescription(LiveSessionDescription(kind: .answer, sdp: created.sdpAnswer))
            guard !ended else { return false }
            sessionId = created.sessionId
        } catch {
            if !ended {
                seams.onError(error.localizedDescription)
                tearDown(.failed)
            }
            return false
        }
        let announced = await announcedStart.value(orAfter: seams.sessionStartTimeout, fallback: false)
        if ended { return false }
        if announced { return true }
        seams.onError(Self.sessionStartTimeoutMessage)
        tearDown(.failed)
        return false
    }

    /// Gathering, under its bound: the handler is cleared whichever won, since the connection outlives this wait.
    private func gatherIce(_ connection: any LivePeerConnection) async {
        if connection.iceGatheringComplete { return }
        let gathered = Settlement<Bool>()
        gathering = gathered
        connection.onIceGatheringStateChange = { [weak connection] in
            guard let connection, connection.iceGatheringComplete else { return }
            gathered.settle(true)
        }
        _ = await gathered.value(orAfter: seams.iceGatheringTimeout, fallback: false)
        gathering = nil
        connection.onIceGatheringStateChange = nil
    }

    // MARK: - The switch

    private func muteAndRelease() async -> Bool {
        let unmuting = pendingSwitch != nil
        let acknowledged = micLive || unmuting ? await switchMicrophone(.mute(eventId: nextId())) : true
        microphone?.isEnabled = false
        micLive = false
        refreshStatus()
        return acknowledged
    }

    private func switchMicrophone(_ event: LiveClientEvent) async -> Bool {
        settleSwitch(false)
        let acknowledgment = Settlement<Bool>()
        pendingSwitch = PendingSwitch(eventId: event.eventId, acknowledgment: acknowledgment)
        send(event)
        let acknowledged = await acknowledgment.value(orAfter: seams.acknowledgmentTimeout, fallback: false)
        if pendingSwitch?.eventId == event.eventId { settleSwitch(false) }
        return acknowledged
    }

    private func acknowledge(_ clientEventId: String?) {
        guard let clientEventId, pendingSwitch?.eventId == clientEventId else { return }
        settleSwitch(true)
    }

    private func settleSwitch(_ acknowledged: Bool) {
        guard let pending = pendingSwitch else { return }
        pendingSwitch = nil
        pending.acknowledgment.settle(acknowledged)
    }

    // MARK: - The channel

    private func send(_ event: LiveClientEvent) {
        guard let channel, channel.isOpen else { return }
        channel.send(event.payload)
    }

    private func receive(_ text: String) {
        guard !ended, let event = LiveServerEvent(payload: text) else { return }
        seams.onServerEvent(event)
        switch event {
        case .sessionStarted:
            started = true
            announcedStart.settle(true)
            refreshStatus()
        case .sessionClosed:
            announcedClose.settle(true)
            tearDown(.idle)
        case .inputAudioMuted, .inputAudioUnmuted:
            acknowledge(event.clientEventId)
        case .error:
            if let about = event.clientEventId, pendingSwitch?.eventId == about { settleSwitch(false) }
        case .inputTranscriptDelta, .outputTranscriptDelta, .usageUpdated, .info:
            break
        }
    }

    private func channelClosed() {
        guard !ended else { return }
        announcedStart.settle(false)
        tearDown(.idle)
    }

    /// A failed connection ends the peer.
    private func transportChanged() {
        guard let connection, let state = connection.transportState else { return }
        if state == .failed, !ended {
            announcedStart.settle(false)
            tearDown(.failed)
        }
    }

    // MARK: - State

    private func refreshStatus() {
        if ended || closing { return }
        status = !started ? .connecting : micLive ? .listening : .muted
    }

    /// Every end of the peer, however it came.
    private func tearDown(_ status: LiveStatus) {
        guard !ended else { return }
        ended = true
        settleSwitch(false)
        gathering?.settle(false)
        announcedStart.settle(false)
        announcedClose.settle(false)
        channel?.onMessage = nil
        channel?.onClose = nil
        connection?.onIceGatheringStateChange = nil
        connection?.onTransportStateChange = nil
        connection?.onRemoteTrack = nil
        microphone?.isEnabled = false
        micLive = false
        remoteTrack = nil
        connection?.close()
        self.status = status
    }

    private func nextId() -> String {
        ids += 1
        return "peer-\(ids)"
    }
}

/// One pending microphone switch, settled by its acknowledgment, the error naming it, or its bound.
private struct PendingSwitch {
    let eventId: String
    let acknowledgment: Settlement<Bool>
}

/// One answer awaited on the main actor and settled once: by whoever holds
/// it, or by its bound, whichever comes first. A value settled before it is
/// awaited is answered at once, so an event that lands early is not lost.
@MainActor
final class Settlement<Value: Sendable> {
    private var value: Value?
    private var continuation: CheckedContinuation<Value, Never>?
    private var bound: Task<Void, Never>?

    func value(orAfter timeout: Duration, fallback: Value) async -> Value {
        if let value { return value }
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            bound = Task { [weak self] in
                try? await Task.sleep(for: timeout)
                guard !Task.isCancelled else { return }
                self?.settle(fallback)
            }
        }
    }

    func settle(_ settled: Value) {
        guard value == nil else { return }
        value = settled
        bound?.cancel()
        bound = nil
        continuation?.resume(returning: settled)
        continuation = nil
    }
}
