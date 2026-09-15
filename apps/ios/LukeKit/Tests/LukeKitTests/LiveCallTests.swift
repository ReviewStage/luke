import Foundation
import XCTest

@testable import LukeKit

// MARK: - Fakes

@MainActor
private final class FakeTrack: LiveAudioTrack {
    var isEnabled = true
}

@MainActor
private final class FakeChannel: LiveDataChannel {
    var isOpen = false
    private(set) var sent: [[String: Any]] = []
    var onMessage: ((String) -> Void)?
    var onClose: (() -> Void)?

    @discardableResult
    func send(_ text: String) -> Bool {
        guard let record = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else {
            return false
        }
        sent.append(record)
        return true
    }

    var sentTypes: [String] { sent.compactMap { $0["type"] as? String } }

    var sentIds: [String] { sent.compactMap { $0["event_id"] as? String } }

    func receive(_ payload: String) {
        onMessage?(payload)
    }

    /// Acknowledges the last switch the channel was sent.
    func acknowledgeLastSwitch() {
        guard let type = sentTypes.last, let id = sentIds.last else { return }
        let answer = type == LiveClientEventType.inputAudioUnmute.rawValue ? "unmuted" : "muted"
        receive(#"{"type":"session.input_audio.\#(answer)","event_id":"event_a","client_event_id":"\#(id)"}"#)
    }
}

@MainActor
private final class FakePeerConnection: LivePeerConnection {
    var transportState: LiveTransportState?
    var iceGatheringComplete = true
    var localDescription: LiveSessionDescription?
    private(set) var channels: [FakeChannel] = []
    private(set) var closeCount = 0
    var onIceGatheringStateChange: (() -> Void)?
    var onTransportStateChange: (() -> Void)?
    var onRemoteTrack: ((any LiveAudioTrack) -> Void)?

    func addAudioTrack(_ track: any LiveAudioTrack) throws {}

    func createDataChannel(label: String) throws -> any LiveDataChannel {
        let channel = FakeChannel()
        channels.append(channel)
        return channel
    }

    func createOffer() async throws -> LiveSessionDescription {
        LiveSessionDescription(kind: .offer, sdp: "v=0\r\noffer\r\n")
    }

    func setLocalDescription(_ description: LiveSessionDescription) async throws {
        localDescription = description
    }

    func setRemoteDescription(_ description: LiveSessionDescription) async throws {
        channels.last?.isOpen = true
    }

    func close() {
        closeCount += 1
        transportState = .closed
    }
}

/// A session on the sessions socket, as the call drives it: every frame it would send, recorded.
@MainActor
private final class FakeSideband: LiveSessionSideband {
    enum Sent: Equatable {
        case activity(idle: Bool)
        case stop
        case hangUp
    }

    let created: LiveSessionCreated
    let events: AsyncStream<HostedVoiceSessionEvent>
    private let continuation: AsyncStream<HostedVoiceSessionEvent>.Continuation
    private(set) var sent: [Sent] = []
    private(set) var closeCount = 0

    init(sessionId: String = "ls_123") {
        created = LiveSessionCreated(sessionId: sessionId, sdpAnswer: "v=0\r\nanswer\r\n")
        var continuation: AsyncStream<HostedVoiceSessionEvent>.Continuation!
        events = AsyncStream(bufferingPolicy: .unbounded) { continuation = $0 }
        self.continuation = continuation
    }

    private(set) var settleCount = 0

    func reportActivity(idle: Bool) { sent.append(.activity(idle: idle)) }
    func stopSpeaking() { sent.append(.stop) }
    func hangUp() { sent.append(.hangUp) }
    func settleSends() async { settleCount += 1 }
    func close() { closeCount += 1 }

    func endForGood(code: Int?) {
        continuation.yield(.closed(code: code))
        continuation.finish()
    }
}

/// The wait the call arms its idle window with. Every window armed stands
/// until the test lets it pass, so the window ends where the test says and
/// never on a clock a loaded runner shares; a window the call cancelled — a
/// word arrived, the call ended — passes with it and is read by nobody.
private final class IdleClock: @unchecked Sendable {
    private let lock = NSLock()
    private var waiting: [AsyncStream<Void>.Continuation] = []
    private var armed: [Duration] = []

    var sleep: VoiceSleep {
        { [self] duration in
            let window = AsyncStream<Void> { continuation in
                lock.withLock {
                    armed.append(duration)
                    waiting.append(continuation)
                }
            }
            for await _ in window {}
        }
    }

    /// Every window armed so far, the cancelled ones among them.
    var windows: [Duration] { lock.withLock { armed } }

    /// Lets every window standing pass.
    func pass() {
        let passing: [AsyncStream<Void>.Continuation] = lock.withLock {
            let standing = waiting
            waiting = []
            return standing
        }
        for continuation in passing { continuation.finish() }
    }
}

/// A call over fakes, with the service scripted and every report recorded.
@MainActor
private final class Harness {
    let connection = FakePeerConnection()
    let idleClock = IdleClock()
    let microphone = FakeTrack()
    var sideband = FakeSideband()
    var refusal: HostedVoiceSessionRefusal?
    /// While set, the service's answer to `session.create` waits for `answerCreate()`.
    var holdsCreate = false
    private var createGate: CheckedContinuation<Void, Never>?
    var voice: LiveVoice = .cedar
    private(set) var offers: [(sdp: String, voice: LiveVoice)] = []
    private(set) var callStarts = 0
    var now = Date(timeIntervalSince1970: 1_000)
    private(set) var call: LiveCall!

    init(
        idleWindow: Duration = .seconds(60),
        speakingHangover: Duration = .seconds(60),
        captionSettleTick: Duration = .seconds(60),
        sessionCloseTimeout: Duration = .seconds(5)
    ) {
        call = LiveCall(
            seams: LiveCallSeams(
                makePeerConnection: { self.connection },
                openMicrophone: { self.microphone },
                createSession: { sdp, voice in
                    self.offers.append((sdp, voice))
                    // The session the service would answer with is the one standing when the offer arrived.
                    let sideband = self.sideband
                    if self.holdsCreate {
                        await withCheckedContinuation { self.createGate = $0 }
                    }
                    if let refusal = self.refusal { return .refused(refusal) }
                    return .opened(sideband)
                },
                voice: { self.voice },
                onCallStarted: { self.callStarts += 1 },
                now: { self.now },
                idleSleep: idleClock.sleep,
                idleWindow: idleWindow,
                speakingHangover: speakingHangover,
                captionSettleTick: captionSettleTick,
                iceGatheringTimeout: .seconds(5),
                sessionStartTimeout: .seconds(5),
                acknowledgmentTimeout: .seconds(5),
                sessionCloseTimeout: sessionCloseTimeout
            )
        )
    }

    var channel: FakeChannel? { connection.channels.last }

    /// The service answering a `session.create` the harness held back.
    func answerCreate() {
        createGate?.resume()
        createGate = nil
    }

    /// A press that opens a session, sees it started, and is acknowledged; whether the call listens at the end of it.
    func pressAndOpen() async -> Bool {
        let channelsBefore = connection.channels.count
        let pressing = Task { await call.beginTalk() }
        await until { self.connection.channels.count > channelsBefore && self.channel?.isOpen == true }
        channel?.receive(#"{"type":"session.started","event_id":"event_1","session":{"id":"ls_123"}}"#)
        return await acknowledgePress(pressing)
    }

    /// A press against a standing session, acknowledged; whether the call listens at the end of it.
    func pressStanding() async -> Bool {
        await acknowledgePress(Task { await call.beginTalk() })
    }

    private func acknowledgePress(_ pressing: Task<Void, Never>) async -> Bool {
        await until { self.channel?.sentTypes.last == LiveClientEventType.inputAudioUnmute.rawValue }
        channel?.acknowledgeLastSwitch()
        await pressing.value
        return call.listening
    }

    func release() async {
        let releasing = Task { await call.endTalk() }
        await until { self.channel?.sentTypes.last == LiveClientEventType.inputAudioMute.rawValue }
        channel?.acknowledgeLastSwitch()
        await releasing.value
    }

    /// The idle window the call is waiting on, passing. Every window standing
    /// on the harness's clock is let through until the call has reported
    /// itself idle, so a window an earlier word already cancelled is never
    /// mistaken for the one the call is waiting on now.
    func passIdleWindow() async {
        await until {
            self.idleClock.pass()
            return self.sideband.sent.last == .activity(idle: true)
        }
    }

    func hear(_ speaker: LiveTranscriptSpeaker, _ text: String, _ startMs: Int, _ endMs: Int) {
        let type = speaker == .user ? "session.input_transcript.delta" : "session.output_transcript.delta"
        channel?.receive(
            #"{"type":"\#(type)","event_id":"event_t\#(startMs)","delta":"\#(text)","start_ms":\#(startMs),"end_ms":\#(endMs)}"#
        )
    }
}

@MainActor
private func until(_ condition: @MainActor () -> Bool) async {
    for _ in 0..<2_000 where !condition() {
        await Task.yield()
    }
}

private func settle(_ duration: Duration = .milliseconds(80)) async throws {
    try await Task.sleep(for: duration)
}

// MARK: - Tests

final class LiveCallTests: XCTestCase {
    @MainActor
    func testAPressOpensThePeerCreatesTheSessionInTheSyncedVoiceAndUnmutesOnTheAcknowledgment() async throws {
        let harness = Harness()
        harness.voice = .willow

        let listening = await harness.pressAndOpen()

        XCTAssertTrue(listening)
        XCTAssertEqual(harness.offers.count, 1)
        XCTAssertEqual(harness.offers.first?.sdp, "v=0\r\noffer\r\n")
        XCTAssertEqual(harness.offers.first?.voice, .willow, "the session is created in the account's synced voice")
        XCTAssertEqual(harness.callStarts, 1, "the call is counted when session.created lands")
        XCTAssertEqual(harness.call.sessionId, "ls_123")
        XCTAssertEqual(harness.call.status, .listening)
        XCTAssertTrue(harness.microphone.isEnabled)
        XCTAssertEqual(harness.channel?.sentTypes, [LiveClientEventType.inputAudioUnmute.rawValue])
        XCTAssertEqual(harness.sideband.sent, [], "nothing goes over the sessions socket for a press")
        XCTAssertNil(harness.call.errorMessage)
    }

    @MainActor
    func testTheReleaseMutesAndASecondPressUnmutesTheStandingSession() async throws {
        let harness = Harness()
        _ = await harness.pressAndOpen()

        await harness.release()
        XCTAssertFalse(harness.microphone.isEnabled)
        XCTAssertEqual(harness.call.status, .muted)

        let listening = await harness.pressStanding()
        XCTAssertTrue(listening)
        XCTAssertEqual(harness.offers.count, 1, "a standing session is unmuted, not opened again")
        XCTAssertEqual(
            harness.channel?.sentTypes,
            [
                LiveClientEventType.inputAudioUnmute.rawValue,
                LiveClientEventType.inputAudioMute.rawValue,
                LiveClientEventType.inputAudioUnmute.rawValue,
            ]
        )
    }

    @MainActor
    func testAReleaseDuringTheOpeningLeavesTheSessionMuted() async throws {
        let harness = Harness()

        let pressing = Task { await harness.call.beginTalk() }
        await until { harness.channel?.isOpen == true }
        XCTAssertEqual(harness.call.status, .connecting)
        await harness.call.endTalk()
        harness.channel?.receive(#"{"type":"session.started","event_id":"event_1","session":{"id":"ls_123"}}"#)
        await pressing.value

        XCTAssertEqual(harness.call.status, .muted)
        XCTAssertEqual(harness.channel?.sentTypes, [], "the microphone rode the offer disabled, so nothing is sent")
        XCTAssertFalse(harness.microphone.isEnabled)
        XCTAssertTrue(harness.call.standing)
    }

    @MainActor
    func testCaptionsAreDrawnFromBothSpeakersDeltasAndLukeSpeaksWhileHisWordsArrive() async throws {
        let harness = Harness(speakingHangover: .milliseconds(30))
        _ = await harness.pressAndOpen()
        await harness.release()

        harness.hear(.user, "Is the build ", 0, 600)
        harness.hear(.user, "green?", 600, 900)
        XCTAssertEqual(harness.call.captions.map(\.words), ["Is the build green?"])
        XCTAssertEqual(harness.call.captions.map(\.speaker), [.user])
        XCTAssertEqual(harness.call.status, .muted)

        harness.hear(.assistant, "It is.", 2_000, 2_400)
        XCTAssertEqual(harness.call.captions.map(\.words), ["Is the build green?", "It is."])
        XCTAssertEqual(harness.call.captions.map(\.rowId), [1, 2])
        XCTAssertEqual(harness.call.status, .speaking, "Luke's words arriving are what say he is speaking")

        try await settle()
        XCTAssertEqual(harness.call.status, .muted, "the hangover passed with no more words")
        XCTAssertEqual(harness.call.captions.count, 2, "the rows stay drawn after he stops")
    }

    @MainActor
    func testRowsSettleInPlaceOnTheTick() async throws {
        let harness = Harness(captionSettleTick: .milliseconds(10))
        _ = await harness.pressAndOpen()

        harness.hear(.assistant, "Done.", 0, 400)
        XCTAssertEqual(harness.call.captions.map(\.settled), [false])

        harness.now = harness.now.addingTimeInterval(2)
        await until { harness.call.captions.first?.settled == true }
        XCTAssertEqual(harness.call.captions, [LiveCaptionRow(rowId: 1, speaker: .assistant, words: "Done.", settled: true)])
    }

    @MainActor
    func testTheStopControlSendsTheServicesStopOnlyWhileLukeSpeaksAndMutes() async throws {
        let harness = Harness()
        _ = await harness.pressAndOpen()

        let stoppingWhileListening = Task { await harness.call.stopSpeaking() }
        await until { harness.channel?.sentTypes.last == LiveClientEventType.inputAudioMute.rawValue }
        harness.channel?.acknowledgeLastSwitch()
        await stoppingWhileListening.value
        XCTAssertEqual(harness.sideband.sent, [], "a silent model is not told to stop")
        XCTAssertEqual(harness.call.status, .muted)

        harness.hear(.assistant, "Let me explain at length", 0, 900)
        XCTAssertEqual(harness.call.status, .speaking)
        await harness.call.stopSpeaking()
        XCTAssertEqual(harness.sideband.sent, [.stop], "the stop is the service's frame, never an instruction of the phone's")
        XCTAssertEqual(
            harness.channel?.sentTypes.filter { $0 == LiveClientEventType.inputAudioMute.rawValue }.count,
            1,
            "an already muted microphone sends no second mute"
        )
    }

    @MainActor
    func testTheIdleWindowIsReportedAsActivityAndTakenBackOnTheNextWord() async throws {
        let harness = Harness(idleWindow: LiveCallBounds.idleWindow)
        _ = await harness.pressAndOpen()
        await harness.release()

        await harness.passIdleWindow()
        XCTAssertEqual(harness.sideband.sent, [.activity(idle: true)])
        XCTAssertEqual(
            harness.idleClock.windows.last,
            LiveCallBounds.idleWindow,
            "the window waited out is the contract's own, not a bound the test shortened"
        )
        XCTAssertTrue(harness.call.standing, "the close is the service's decision, not the peer's")

        harness.hear(.assistant, "Still here.", 0, 400)
        XCTAssertEqual(harness.sideband.sent, [.activity(idle: true), .activity(idle: false)])

        await harness.passIdleWindow()
        XCTAssertEqual(
            harness.sideband.sent,
            [.activity(idle: true), .activity(idle: false), .activity(idle: true)],
            "quiet again, reported again"
        )
    }

    @MainActor
    func testTheHangUpGoesOverTheSessionsSocketAndThePeerEndsOnTheSessionsClosed() async throws {
        let harness = Harness()
        _ = await harness.pressAndOpen()
        harness.hear(.user, "Bye", 0, 300)

        let hangingUp = Task { await harness.call.hangUp() }
        await until { harness.sideband.sent == [.hangUp] }
        XCTAssertEqual(harness.call.status, .closing)
        harness.channel?.receive(
            #"{"type":"session.closed","event_id":"event_c","reason":"close_requested","usage":{"seconds":12}}"#
        )
        await hangingUp.value

        XCTAssertEqual(harness.sideband.sent, [.hangUp])
        XCTAssertFalse(
            harness.channel?.sentTypes.contains(LiveClientEventType.close.rawValue) ?? true,
            "the data channel carried no close of the phone's: the service's close ended the session"
        )
        XCTAssertEqual(harness.call.status, .idle)
        XCTAssertFalse(harness.call.standing)
        XCTAssertEqual(harness.connection.closeCount, 1)
        XCTAssertEqual(harness.sideband.closeCount, 1, "the socket is let go of with the peer")
        XCTAssertEqual(harness.call.captions, [], "the record is the Conversation's; the rows go with the call")
    }

    @MainActor
    func testAServiceCloseThatNeverComesBackLeavesTheHangUpToThePeersOwnClose() async throws {
        let harness = Harness(sessionCloseTimeout: .milliseconds(20))
        _ = await harness.pressAndOpen()

        let hangingUp = Task { await harness.call.hangUp() }
        await until { harness.channel?.sentTypes.last == LiveClientEventType.close.rawValue }
        harness.channel?.receive(
            #"{"type":"session.closed","event_id":"event_c","reason":"close_requested","usage":{"seconds":1}}"#
        )
        await hangingUp.value

        XCTAssertEqual(harness.sideband.sent, [.hangUp])
        XCTAssertEqual(harness.channel?.sentTypes.last, LiveClientEventType.close.rawValue)
        XCTAssertEqual(harness.call.status, .idle)
        XCTAssertEqual(harness.sideband.closeCount, 1)
    }

    @MainActor
    func testTheSocketEndingForGoodClosesThePeerItself() async throws {
        let harness = Harness()
        _ = await harness.pressAndOpen()

        harness.sideband.endForGood(code: 1006)
        await until { harness.channel?.sentTypes.last == LiveClientEventType.close.rawValue }
        XCTAssertEqual(harness.call.status, .closing)
        harness.channel?.receive(
            #"{"type":"session.closed","event_id":"event_c","reason":"close_requested","usage":{"seconds":1}}"#
        )
        await until { harness.call.status == .idle }

        XCTAssertEqual(harness.sideband.sent, [], "no socket stands to carry the hang-up")
        XCTAssertFalse(harness.call.standing)
    }

    @MainActor
    func testAHangUpBeforeTheSessionStartedSendsTheServicesCloseAndTearsThePeerDownAtOnce() async throws {
        let harness = Harness()

        let pressing = Task { await harness.call.beginTalk() }
        await until { harness.channel?.isOpen == true }
        XCTAssertEqual(harness.call.sessionId, "ls_123", "the session was created; it has not announced itself started")
        await harness.call.hangUp()
        await pressing.value

        XCTAssertEqual(harness.sideband.sent, [.hangUp])
        XCTAssertEqual(harness.sideband.settleCount, 1, "the frame is waited onto the wire before the socket goes")
        XCTAssertEqual(harness.sideband.closeCount, 1)
        XCTAssertEqual(harness.channel?.sentTypes, [], "no channel stood started to carry a close or hear session.closed")
        XCTAssertEqual(harness.call.status, .idle)
        XCTAssertFalse(harness.call.standing)
    }

    @MainActor
    func testASessionTheServiceAnswersAfterAHangUpIsEndedNotAdopted() async throws {
        let harness = Harness()
        harness.holdsCreate = true

        let pressing = Task { await harness.call.beginTalk() }
        await until { harness.offers.count == 1 }
        await harness.call.hangUp()
        XCTAssertEqual(harness.call.status, .idle)
        XCTAssertFalse(harness.call.standing)

        let late = harness.sideband
        harness.sideband = FakeSideband(sessionId: "ls_456")
        harness.holdsCreate = false
        let second = Task { await harness.pressAndOpen() }
        await until { harness.offers.count == 2 }
        harness.answerCreate()
        await pressing.value
        let listening = await second.value

        XCTAssertTrue(listening, "the newer press has a session of its own")
        XCTAssertEqual(harness.call.sessionId, "ls_456")
        XCTAssertEqual(late.sent, [.hangUp], "the late session is ended over its own socket, never adopted")
        await until { late.closeCount == 1 }
        XCTAssertEqual(late.closeCount, 1)
        XCTAssertEqual(late.settleCount, 1)
        XCTAssertEqual(harness.callStarts, 1, "only the session a call adopted is counted")
        XCTAssertEqual(harness.sideband.sent, [])
    }

    @MainActor
    func testAPressDuringTheHangUpWaitsForItAndOpensANewSession() async throws {
        let harness = Harness()
        _ = await harness.pressAndOpen()

        let hangingUp = Task { await harness.call.hangUp() }
        await until { harness.sideband.sent == [.hangUp] }
        let first = harness.sideband
        harness.sideband = FakeSideband(sessionId: "ls_456")
        let pressing = Task { await harness.call.beginTalk() }
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(harness.call.status, .closing, "the press waits rather than joining the call on its way out")
        XCTAssertEqual(harness.channel?.sentTypes, [LiveClientEventType.inputAudioUnmute.rawValue], "no unmute goes to a closing session")

        harness.channel?.receive(
            #"{"type":"session.closed","event_id":"event_c","reason":"close_requested","usage":{"seconds":9}}"#
        )
        await hangingUp.value
        await until { harness.connection.channels.count == 2 && harness.channel?.isOpen == true }
        harness.channel?.receive(#"{"type":"session.started","event_id":"event_2","session":{"id":"ls_456"}}"#)
        await until { harness.channel?.sentTypes.last == LiveClientEventType.inputAudioUnmute.rawValue }
        harness.channel?.acknowledgeLastSwitch()
        await pressing.value

        XCTAssertTrue(harness.call.listening)
        XCTAssertEqual(harness.call.sessionId, "ls_456")
        XCTAssertEqual(harness.offers.count, 2)
        XCTAssertEqual(first.closeCount, 1)
        XCTAssertEqual(harness.callStarts, 2)
    }

    @MainActor
    func testTheServicesCloseEndsTheCallWithoutAPress() async throws {
        let harness = Harness()
        _ = await harness.pressAndOpen()

        harness.channel?.receive(
            #"{"type":"session.closed","event_id":"event_c","reason":"expired","usage":{"seconds":300}}"#
        )

        XCTAssertEqual(harness.call.status, .idle)
        XCTAssertFalse(harness.call.standing)
        XCTAssertEqual(harness.sideband.closeCount, 1)
        XCTAssertEqual(harness.connection.closeCount, 1)

        harness.sideband = FakeSideband(sessionId: "ls_456")
        let listening = await harness.pressAndOpen()
        XCTAssertTrue(listening, "the next press opens a new session")
        XCTAssertEqual(harness.call.sessionId, "ls_456")
        XCTAssertEqual(harness.offers.count, 2)
        XCTAssertEqual(harness.callStarts, 2)
    }

    @MainActor
    func testARefusalIsWordedAsTheDesktopWordsItAndCountsNoCall() async throws {
        let harness = Harness()
        harness.refusal = .notSignedIn
        await harness.call.beginTalk()
        XCTAssertEqual(harness.call.errorMessage, "Voice is off: sign in to turn it on.")
        XCTAssertEqual(harness.call.status, .failed)
        XCTAssertEqual(harness.callStarts, 0)
        XCTAssertFalse(harness.call.standing)

        harness.refusal = .hostedUnavailable
        await harness.call.beginTalk()
        XCTAssertEqual(harness.call.errorMessage, "Voice is temporarily unavailable. Try again later.")

        harness.refusal = .quotaExhausted(nil)
        await harness.call.beginTalk()
        XCTAssertEqual(harness.call.errorMessage, "Voice is temporarily unavailable. Try again later.")

        harness.refusal = .httpError(status: 403)
        await harness.call.beginTalk()
        XCTAssertEqual(harness.call.errorMessage, "Luke could not open a voice session.", "a 403 is the peer's own word, as on the desktop")

        harness.refusal = nil
        harness.sideband = FakeSideband()
        let listening = await harness.pressAndOpen()
        XCTAssertTrue(listening, "a refusal leaves the next press free to try again")
        XCTAssertNil(harness.call.errorMessage, "the next open clears the last refusal")
    }

    @MainActor
    func testAQuotaRefusalShowsTheAllowanceWhereTheServiceSaidIt() async throws {
        let quota = try XCTUnwrap(
            HostedQuota(json: .object(["used": .number(50), "limit": .number(50), "resetsAt": .number(1_800_003_600_000)]))
        )
        XCTAssertEqual(
            LiveCall.note(for: .quotaExhausted(quota))?.hasPrefix(
                "Voice is temporarily unavailable. Try again later. Your allowance is spent (50 of 50); it resets "
            ),
            true
        )
        XCTAssertNil(LiveCall.note(for: .networkError), "the peer's own word stands for the rest")
        XCTAssertNil(LiveCall.note(for: .refused(.invalidRequest)))
        XCTAssertNil(LiveCall.note(for: .malformedResponse))
    }
}
