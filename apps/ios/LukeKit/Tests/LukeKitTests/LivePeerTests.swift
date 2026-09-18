import Foundation
import XCTest

@testable import LukeKit

// MARK: - Fakes

/// What the fake peer did, in the order it did it, so the guide's order can be asserted.
private enum PeerStep: Equatable {
    case addTrack
    case createChannel
    case createOffer
    case setLocal
    case setRemote
    case close
}

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

    /// The server's event, as the channel would hand it up.
    func receive(_ payload: String) {
        onMessage?(payload)
    }

    func dropped() {
        isOpen = false
        onClose?()
    }
}

@MainActor
private final class FakePeerConnection: LivePeerConnection {
    var transportState: LiveTransportState?
    var iceGatheringComplete = false
    var localDescription: LiveSessionDescription?
    private(set) var steps: [PeerStep] = []
    private(set) var channels: [FakeChannel] = []
    private(set) var added: [FakeTrack] = []
    private(set) var remoteSdp: String?
    var onIceGatheringStateChange: (() -> Void)?
    var onTransportStateChange: (() -> Void)?
    var onRemoteTrack: ((any LiveAudioTrack) -> Void)?

    func addAudioTrack(_ track: any LiveAudioTrack) throws {
        steps.append(.addTrack)
        guard let fake = track as? FakeTrack else { return XCTFail("the track on the line is the microphone's") }
        added.append(fake)
    }

    func createDataChannel(label: String) throws -> any LiveDataChannel {
        XCTAssertEqual(label, "oai-events")
        steps.append(.createChannel)
        let channel = FakeChannel()
        channels.append(channel)
        return channel
    }

    func createOffer() async throws -> LiveSessionDescription {
        steps.append(.createOffer)
        return LiveSessionDescription(kind: .offer, sdp: "v=0\r\noffer\r\n")
    }

    func setLocalDescription(_ description: LiveSessionDescription) async throws {
        steps.append(.setLocal)
        localDescription = description
    }

    func setRemoteDescription(_ description: LiveSessionDescription) async throws {
        steps.append(.setRemote)
        remoteSdp = description.sdp
        XCTAssertEqual(description.kind, .answer)
        channels.last?.isOpen = true
    }

    func close() {
        steps.append(.close)
        transportState = .closed
    }

    func gathered() {
        iceGatheringComplete = true
        onIceGatheringStateChange?()
    }

    func transport(_ state: LiveTransportState) {
        transportState = state
        onTransportStateChange?()
    }
}

/// A peer over fakes, with every report recorded.
@MainActor
private final class Harness {
    let connection = FakePeerConnection()
    let microphone = FakeTrack()
    private(set) var statuses: [LiveStatus] = []
    private(set) var events: [LiveServerEvent] = []
    private(set) var errors: [String] = []
    private(set) var offers: [String] = []
    var created: LiveSessionCreated? = LiveSessionCreated(sessionId: "live_123", sdpAnswer: "v=0\r\nanswer\r\n")
    var microphoneOpens = 0
    /// The device's audio route: active between the peer's activation and its release.
    private(set) var audioActive = false
    /// Whether the route was active as each microphone opened.
    private(set) var audioActiveAtMicrophoneOpen: [Bool] = []
    private(set) var audioReleases = 0
    private(set) var peer: LivePeer!

    init(
        iceGatheringTimeout: Duration = .seconds(5),
        sessionStartTimeout: Duration = .seconds(5),
        acknowledgmentTimeout: Duration = .seconds(5),
        sessionCloseTimeout: Duration = .seconds(5)
    ) {
        peer = LivePeer(
            seams: LivePeerSeams(
                makePeerConnection: { self.connection },
                activateAudio: { self.audioActive = true },
                releaseAudio: {
                    self.audioActive = false
                    self.audioReleases += 1
                },
                openMicrophone: {
                    self.microphoneOpens += 1
                    self.audioActiveAtMicrophoneOpen.append(self.audioActive)
                    return self.microphone
                },
                createSession: { sdp in
                    self.offers.append(sdp)
                    return self.created
                },
                onStatus: { self.statuses.append($0) },
                onServerEvent: { self.events.append($0) },
                onError: { self.errors.append($0) },
                iceGatheringTimeout: iceGatheringTimeout,
                sessionStartTimeout: sessionStartTimeout,
                acknowledgmentTimeout: acknowledgmentTimeout,
                sessionCloseTimeout: sessionCloseTimeout
            )
        )
    }

    var channel: FakeChannel? { connection.channels.last }

    /// Opens the peer and answers `session.started` once the answer is set; whether it stood.
    func openStarted() async -> Bool {
        let opening = Task { await peer.open() }
        await until { self.connection.steps.contains(.setLocal) }
        connection.gathered()
        await until { self.connection.steps.contains(.setRemote) }
        channel?.receive(#"{"type":"session.started","event_id":"event_1","session":{"id":"live_123"}}"#)
        return await opening.value
    }
}

/// Yields to the main actor until the condition holds, or gives up after a bounded number of turns.
@MainActor
private func until(_ condition: @MainActor () -> Bool) async {
    for _ in 0..<2_000 where !condition() {
        await Task.yield()
    }
}

/// Lets a bound shorter than this settle.
private func settle(_ duration: Duration = .milliseconds(80)) async throws {
    try await Task.sleep(for: duration)
}

private let mutedAck = #"{"type":"session.input_audio.muted","event_id":"event_m","client_event_id":"%@"}"#
private let unmutedAck = #"{"type":"session.input_audio.unmuted","event_id":"event_u","client_event_id":"%@"}"#

private func acknowledgment(_ template: String, of eventId: String) -> String {
    template.replacingOccurrences(of: "%@", with: eventId)
}

// MARK: - Tests

final class LivePeerTests: XCTestCase {
    @MainActor
    func testThePeerIsBuiltInTheGuidesOrderAndStandsOnceStarted() async throws {
        let harness = Harness()
        XCTAssertEqual(harness.peer.status, .idle)

        let stood = await harness.openStarted()

        XCTAssertTrue(stood)
        XCTAssertEqual(harness.connection.steps, [.addTrack, .createChannel, .createOffer, .setLocal, .setRemote])
        XCTAssertEqual(harness.microphoneOpens, 1)
        XCTAssertEqual(harness.connection.added.count, 1)
        XCTAssertTrue(harness.connection.added.first === harness.microphone)
        XCTAssertFalse(harness.microphone.isEnabled, "the microphone rides the offer disabled until the unmute is acknowledged")
        XCTAssertEqual(harness.offers, ["v=0\r\noffer\r\n"])
        XCTAssertEqual(harness.connection.remoteSdp, "v=0\r\nanswer\r\n")
        XCTAssertEqual(harness.peer.sessionId, "live_123")
        XCTAssertEqual(harness.peer.status, .muted)
        XCTAssertEqual(harness.statuses, [.connecting, .muted])
        XCTAssertTrue(harness.peer.standing)
        XCTAssertFalse(harness.peer.listening)
        XCTAssertEqual(harness.channel?.sent.count, 0, "nothing goes on the channel to start a session")
        XCTAssertEqual(harness.events, [.sessionStarted(eventId: "event_1", sessionId: "live_123")])
    }

    @MainActor
    func testTheAudioRouteIsActiveBeforeTheMicrophoneOpensAndGivenBackAtTheEnd() async throws {
        let harness = Harness()

        let stood = await harness.openStarted()

        XCTAssertTrue(stood)
        XCTAssertEqual(harness.audioActiveAtMicrophoneOpen, [true], "the route records before the microphone opens on it")
        XCTAssertTrue(harness.audioActive, "the route is held for the peer's life")

        harness.channel?.receive(#"{"type":"session.closed","event_id":"event_2","session":{"id":"live_123"}}"#)

        XCTAssertFalse(harness.audioActive)
        XCTAssertEqual(harness.audioReleases, 1)
        XCTAssertEqual(harness.peer.status, .idle)
    }

    @MainActor
    func testAFailedOpenGivesTheAudioRouteBackToo() async throws {
        let harness = Harness()
        harness.created = nil

        let opening = Task { await harness.peer.open() }
        await until { harness.connection.steps.contains(.setLocal) }
        harness.connection.gathered()
        let stood = await opening.value

        XCTAssertFalse(stood)
        XCTAssertFalse(harness.audioActive)
        XCTAssertEqual(harness.audioReleases, 1)
    }

    @MainActor
    func testIceGatheringThatNeverCompletesSendsTheOfferAtTheBound() async throws {
        let harness = Harness(iceGatheringTimeout: .milliseconds(20))

        let opening = Task { await harness.peer.open() }
        await until { harness.connection.steps.contains(.setRemote) }
        harness.channel?.receive(#"{"type":"session.started","event_id":"event_1","session":{"id":"live_123"}}"#)
        let stood = await opening.value

        XCTAssertTrue(stood)
        XCTAssertFalse(harness.connection.iceGatheringComplete)
        XCTAssertEqual(harness.offers.count, 1)
        XCTAssertNil(harness.connection.onIceGatheringStateChange, "the handler is cleared whichever way the wait ended")
    }

    @MainActor
    func testAHostThatCreatesNoSessionLeavesThePeerClosedAndTheOpenFailed() async throws {
        let harness = Harness()
        harness.created = nil

        let opening = Task { await harness.peer.open() }
        await until { harness.connection.steps.contains(.setLocal) }
        harness.connection.gathered()
        let stood = await opening.value

        XCTAssertFalse(stood)
        XCTAssertEqual(harness.connection.steps, [.addTrack, .createChannel, .createOffer, .setLocal, .close])
        XCTAssertEqual(harness.errors, ["Luke could not open a voice session."])
        XCTAssertEqual(harness.peer.status, .failed)
        XCTAssertEqual(harness.statuses, [.connecting, .failed])
        XCTAssertFalse(harness.peer.standing)
        XCTAssertNil(harness.peer.sessionId)
    }

    @MainActor
    func testASessionThatNeverAnnouncesItselfStartedIsGivenUpAtTheBound() async throws {
        let harness = Harness(sessionStartTimeout: .milliseconds(20))

        let opening = Task { await harness.peer.open() }
        await until { harness.connection.steps.contains(.setLocal) }
        harness.connection.gathered()
        let stood = await opening.value

        XCTAssertFalse(stood)
        XCTAssertEqual(harness.connection.steps.last, .close)
        XCTAssertEqual(harness.errors, ["The voice session did not start."])
        XCTAssertEqual(harness.peer.status, .failed)
    }

    @MainActor
    func testUnmuteAndMuteSendTheSwitchAndFlipTheTrackOnlyOnTheAcknowledgment() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)
        let channel = try XCTUnwrap(harness.channel)

        let unmuting = Task { await harness.peer.unmute() }
        await until { channel.sentTypes == ["session.input_audio.unmute"] }
        XCTAssertFalse(harness.microphone.isEnabled, "the track waits for the acknowledgment")
        XCTAssertEqual(harness.peer.status, .muted)
        channel.receive(acknowledgment(unmutedAck, of: "not-this-one"))
        await Task.yield()
        XCTAssertFalse(harness.microphone.isEnabled, "an acknowledgment of another command is not this one's")
        channel.receive(acknowledgment(unmutedAck, of: channel.sentIds[0]))
        let unmuted = await unmuting.value

        XCTAssertTrue(unmuted)
        XCTAssertTrue(harness.microphone.isEnabled)
        XCTAssertTrue(harness.peer.listening)
        XCTAssertEqual(harness.peer.status, .listening)

        let muting = Task { await harness.peer.mute() }
        await until { channel.sentTypes.count == 2 }
        XCTAssertEqual(channel.sentTypes[1], "session.input_audio.mute")
        XCTAssertTrue(harness.microphone.isEnabled, "the track stays live until the mute is answered")
        channel.receive(acknowledgment(mutedAck, of: channel.sentIds[1]))
        let muted = await muting.value

        XCTAssertTrue(muted)
        XCTAssertFalse(harness.microphone.isEnabled)
        XCTAssertFalse(harness.peer.listening)
        XCTAssertEqual(harness.peer.status, .muted)
        XCTAssertEqual(harness.statuses, [.connecting, .muted, .listening, .muted])
        XCTAssertEqual(Set(channel.sentIds).count, 2, "every command carries an id of its own")
    }

    @MainActor
    func testAnErrorNamingTheSwitchRefusesIt() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)
        let channel = try XCTUnwrap(harness.channel)

        let unmuting = Task { await harness.peer.unmute() }
        await until { channel.sentTypes.count == 1 }
        channel.receive(
            #"{"type":"error","event_id":"event_e","error":{"code":"muted_elsewhere","client_event_id":"\#(channel.sentIds[0])"}}"#
        )
        let unmuted = await unmuting.value

        XCTAssertFalse(unmuted)
        XCTAssertFalse(harness.microphone.isEnabled)
        XCTAssertEqual(harness.peer.status, .muted)
        XCTAssertEqual(harness.events.last?.type, .error)
    }

    @MainActor
    func testASwitchTheServerNeverAcknowledgesIsGivenUpAtTheBoundAndTheMuteStillDisablesTheTrack() async throws {
        let harness = Harness(acknowledgmentTimeout: .milliseconds(20))
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)
        let channel = try XCTUnwrap(harness.channel)

        let unmuted = await harness.peer.unmute()
        XCTAssertFalse(unmuted)
        XCTAssertFalse(harness.microphone.isEnabled)

        channel.receive(acknowledgment(unmutedAck, of: channel.sentIds[0]))
        await Task.yield()
        XCTAssertFalse(harness.microphone.isEnabled, "an acknowledgment after the bound moves nothing")

        let unmutingAgain = Task { await harness.peer.unmute() }
        await until { channel.sentTypes.count == 2 }
        channel.receive(acknowledgment(unmutedAck, of: channel.sentIds[1]))
        let unmutedAgain = await unmutingAgain.value
        XCTAssertTrue(unmutedAgain)
        XCTAssertTrue(harness.microphone.isEnabled)

        let muted = await harness.peer.mute()
        XCTAssertFalse(muted, "the answer stays the session's own word on the switch")
        XCTAssertFalse(harness.microphone.isEnabled, "the key being up is the developer's decision")
        XCTAssertEqual(harness.peer.status, .muted)
        XCTAssertEqual(
            channel.sentTypes,
            ["session.input_audio.unmute", "session.input_audio.unmute", "session.input_audio.mute"]
        )
    }

    @MainActor
    func testAMuteDuringAnUnmuteStillAwaitingItsAcknowledgmentGivesTheUnmuteUpAndMutesAnyway() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)
        let channel = try XCTUnwrap(harness.channel)

        let unmuting = Task { await harness.peer.unmute() }
        await until { channel.sentTypes.count == 1 }
        let muting = Task { await harness.peer.mute() }
        await until { channel.sentTypes.count == 2 }
        XCTAssertEqual(channel.sentTypes, ["session.input_audio.unmute", "session.input_audio.mute"])
        let unmuted = await unmuting.value
        XCTAssertFalse(unmuted)
        channel.receive(acknowledgment(unmutedAck, of: channel.sentIds[0]))
        channel.receive(acknowledgment(mutedAck, of: channel.sentIds[1]))
        let muted = await muting.value
        XCTAssertTrue(muted)
        XCTAssertFalse(harness.microphone.isEnabled, "the late unmute acknowledgment moves nothing")
        XCTAssertEqual(harness.peer.status, .muted)
    }

    @MainActor
    func testAPressLandingWhileAMuteIsInFlightWaitsForIt() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)
        let channel = try XCTUnwrap(harness.channel)

        let unmuting = Task { await harness.peer.unmute() }
        await until { channel.sentTypes.count == 1 }
        channel.receive(acknowledgment(unmutedAck, of: channel.sentIds[0]))
        let unmuted = await unmuting.value
        XCTAssertTrue(unmuted)

        let muting = Task { await harness.peer.mute() }
        await until { channel.sentTypes.count == 2 }
        let pressing = Task { await harness.peer.unmute() }
        try await settle(.milliseconds(20))
        XCTAssertEqual(channel.sentTypes.count, 2, "the press waits for the mute to settle")
        channel.receive(acknowledgment(mutedAck, of: channel.sentIds[1]))
        let muted = await muting.value
        XCTAssertTrue(muted)
        await until { channel.sentTypes.count == 3 }
        XCTAssertEqual(channel.sentTypes[2], "session.input_audio.unmute")
        channel.receive(acknowledgment(unmutedAck, of: channel.sentIds[2]))
        let pressed = await pressing.value
        XCTAssertTrue(pressed)
        XCTAssertTrue(harness.microphone.isEnabled)
    }

    @MainActor
    func testASwitchBeforeTheSessionStandsIsRefusedWithoutSendingAnything() async throws {
        let harness = Harness()

        let unmuted = await harness.peer.unmute()
        XCTAssertFalse(unmuted)
        let muted = await harness.peer.mute()
        XCTAssertFalse(muted)
        let announced = await harness.peer.close()
        XCTAssertFalse(announced)
        XCTAssertEqual(harness.peer.status, .idle)
        XCTAssertEqual(harness.connection.steps, [])
    }

    @MainActor
    func testAFailedConnectionEndsThePeer() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)

        harness.connection.transport(.connecting)
        harness.connection.transport(.connected)
        harness.connection.transport(.disconnected)
        XCTAssertTrue(harness.peer.standing)

        harness.connection.transport(.failed)

        XCTAssertFalse(harness.peer.standing)
        XCTAssertEqual(harness.peer.status, .failed)
        XCTAssertEqual(harness.connection.steps.last, .close)
        XCTAssertFalse(harness.microphone.isEnabled)
        XCTAssertNil(harness.channel?.onMessage)
        XCTAssertNil(harness.connection.onTransportStateChange)
    }

    @MainActor
    func testTheHangUpSendsCloseHoldsEverythingOpenUntilClosedArrivesThenTearsDown() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)
        let channel = try XCTUnwrap(harness.channel)

        let closing = Task { await harness.peer.close() }
        await until { channel.sentTypes == ["session.close"] }
        XCTAssertEqual(harness.peer.status, .closing)
        XCTAssertTrue(harness.peer.standing, "the connection stays open while the session drains")
        XCTAssertFalse(harness.connection.steps.contains(.close))
        channel.receive(
            #"{"type":"session.closed","event_id":"event_9","reason":"close_requested","usage":{"seconds":12}}"#
        )
        let announced = await closing.value

        XCTAssertTrue(announced)
        XCTAssertEqual(harness.peer.status, .idle)
        XCTAssertEqual(harness.connection.steps.last, .close)
        XCTAssertEqual(harness.events.last, .sessionClosed(eventId: "event_9", reason: .closeRequested, usageSeconds: 12))
        XCTAssertEqual(harness.statuses, [.connecting, .muted, .closing, .idle])
        let closedAgain = await harness.peer.close()
        XCTAssertFalse(closedAgain, "a second hang-up has nothing to close")
    }

    @MainActor
    func testTheHangUpGivesUpAtTheBound() async throws {
        let harness = Harness(sessionCloseTimeout: .milliseconds(20))
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)

        let announced = await harness.peer.close()

        XCTAssertFalse(announced)
        XCTAssertEqual(harness.channel?.sentTypes, ["session.close"])
        XCTAssertEqual(harness.peer.status, .idle)
        XCTAssertEqual(harness.connection.steps.last, .close)
    }

    @MainActor
    func testTheServersOwnCloseEndsThePeer() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)

        harness.channel?.receive(
            #"{"type":"session.closed","event_id":"event_9","reason":"expired","usage":{"seconds":600}}"#
        )

        XCTAssertFalse(harness.peer.standing)
        XCTAssertEqual(harness.peer.status, .idle)
        XCTAssertEqual(harness.connection.steps.last, .close)
        XCTAssertEqual(harness.channel?.sent.count, 0)
    }

    @MainActor
    func testAChannelThatClosesUnderTheCallEndsIt() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)

        harness.channel?.dropped()

        XCTAssertFalse(harness.peer.standing)
        XCTAssertEqual(harness.peer.status, .idle)
        XCTAssertEqual(harness.connection.steps.last, .close)
    }

    @MainActor
    func testAHangUpOverAChannelThatCannotCarryItTearsDownAtOnceAndAnswersUnannounced() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)
        harness.channel?.isOpen = false

        let announced = await harness.peer.close()

        XCTAssertFalse(announced)
        XCTAssertEqual(harness.channel?.sent.count, 0)
        XCTAssertEqual(harness.peer.status, .idle)
        XCTAssertEqual(harness.connection.steps.last, .close)
    }

    @MainActor
    func testAHangUpWhileTheOpenIsStillNegotiatingEndsIt() async throws {
        let harness = Harness()

        let opening = Task { await harness.peer.open() }
        await until { harness.connection.steps.contains(.setLocal) }
        let announced = await harness.peer.close()
        harness.connection.gathered()
        let stood = await opening.value

        XCTAssertFalse(announced)
        XCTAssertFalse(stood)
        XCTAssertEqual(harness.peer.status, .idle)
        XCTAssertEqual(harness.connection.steps.last, .close)
        XCTAssertEqual(harness.offers, [], "an offer is not handed to the host for a peer already closed")
        XCTAssertEqual(harness.errors, [])
    }

    @MainActor
    func testAHangUpOnTheFirstTurnAfterTheOpenStillClosesThePeerItBuilt() async throws {
        let harness = Harness()

        let opening = Task { await harness.peer.open() }
        await Task.yield()
        let announced = await harness.peer.close()
        let stood = await opening.value

        XCTAssertFalse(announced)
        XCTAssertFalse(stood)
        XCTAssertEqual(harness.connection.steps.first, .addTrack, "the connection is built before the open first suspends")
        XCTAssertEqual(harness.connection.steps.last, .close)
        XCTAssertFalse(harness.connection.steps.contains(.setRemote))
        XCTAssertEqual(harness.offers, [])
        XCTAssertEqual(harness.microphoneOpens, 1)
        XCTAssertFalse(harness.microphone.isEnabled)
        XCTAssertEqual(harness.peer.status, .idle)
        XCTAssertEqual(harness.statuses, [.connecting, .closing, .idle])
        XCTAssertFalse(harness.peer.standing)
    }

    @MainActor
    func testAPeerThatFailsRightAfterStartingDoesNotReadAsOpened() async throws {
        let harness = Harness()

        let opening = Task { await harness.peer.open() }
        await until { harness.connection.steps.contains(.setLocal) }
        harness.connection.gathered()
        await until { harness.connection.steps.contains(.setRemote) }
        harness.channel?.receive(#"{"type":"session.started","event_id":"event_1","session":{"id":"live_123"}}"#)
        harness.connection.transport(.failed)
        let stood = await opening.value

        XCTAssertFalse(stood)
        XCTAssertFalse(harness.peer.standing)
        XCTAssertEqual(harness.peer.status, .failed)
        XCTAssertEqual(harness.connection.steps.last, .close)
        XCTAssertEqual(harness.errors, [], "a transport failure is not a start that timed out")
    }

    @MainActor
    func testTheOnlyRecordsThePeerSendsAreTheTwoSwitchesAndTheCloseInTheChannelsOwnOrder() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)
        let channel = try XCTUnwrap(harness.channel)

        let unmuting = Task { await harness.peer.unmute() }
        await until { channel.sentTypes.count == 1 }
        channel.receive(acknowledgment(unmutedAck, of: channel.sentIds[0]))
        let unmuted = await unmuting.value
        XCTAssertTrue(unmuted)
        let muting = Task { await harness.peer.mute() }
        await until { channel.sentTypes.count == 2 }
        channel.receive(acknowledgment(mutedAck, of: channel.sentIds[1]))
        let muted = await muting.value
        XCTAssertTrue(muted)
        let closing = Task { await harness.peer.close() }
        await until { channel.sentTypes.count == 3 }
        channel.receive(
            #"{"type":"session.closed","event_id":"event_9","reason":"close_requested","usage":{"seconds":3}}"#
        )
        let announced = await closing.value
        XCTAssertTrue(announced)

        XCTAssertEqual(channel.sentTypes, ["session.input_audio.unmute", "session.input_audio.mute", "session.close"])
        XCTAssertEqual(channel.sentIds, ["peer-1", "peer-2", "peer-3"])
        for record in channel.sent {
            XCTAssertEqual(Set(record.keys), ["type", "event_id"], "a command carries its type and id and nothing else")
        }
    }

    @MainActor
    func testEveryEventTheDeviceIsShownIsHandedOnDecodedAndTheRestAreDropped() async throws {
        let harness = Harness()
        let stood = await harness.openStarted()
        XCTAssertTrue(stood)
        let channel = try XCTUnwrap(harness.channel)

        channel.receive(
            #"{"type":"session.input_transcript.delta","event_id":"event_2","delta":"What is","start_ms":1000,"end_ms":1200}"#
        )
        channel.receive(
            #"{"type":"session.output_transcript.delta","event_id":"event_3","delta":" the","start_ms":1300,"end_ms":1400}"#
        )
        channel.receive(#"{"type":"session.usage.updated","event_id":"event_6","usage":{"seconds":12}}"#)
        channel.receive(#"{"type":"info","event_id":"event_7","code":"data_channel_permissions"}"#)
        channel.receive(
            #"{"type":"session.delegation.created","event_id":"event_8","offset_ms":10,"delegation":{"id":"dlg_1","target":"client"}}"#
        )
        channel.receive("not json")

        XCTAssertEqual(
            harness.events,
            [
                .sessionStarted(eventId: "event_1", sessionId: "live_123"),
                .inputTranscriptDelta(LiveTranscriptDelta(eventId: "event_2", delta: "What is", startMs: 1000, endMs: 1200)),
                .outputTranscriptDelta(LiveTranscriptDelta(eventId: "event_3", delta: " the", startMs: 1300, endMs: 1400)),
                .usageUpdated(eventId: "event_6", usageSeconds: 12),
                .info(eventId: "event_7", code: "data_channel_permissions", message: nil),
            ]
        )
        XCTAssertEqual(harness.peer.status, .muted, "captions and usage move no status")
    }

    @MainActor
    func testASecondOpenWhileTheFirstIsStillNegotiatingAnswersThatOne() async throws {
        let harness = Harness()

        let first = Task { await harness.peer.open() }
        await until { harness.connection.steps.contains(.setLocal) }
        let second = Task { await harness.peer.open() }
        harness.connection.gathered()
        await until { harness.connection.steps.contains(.setRemote) }
        harness.channel?.receive(#"{"type":"session.started","event_id":"event_1","session":{"id":"live_123"}}"#)

        let firstStood = await first.value
        XCTAssertTrue(firstStood)
        let secondStood = await second.value
        XCTAssertTrue(secondStood)
        XCTAssertEqual(harness.connection.steps.filter { $0 == .createOffer }.count, 1)
        XCTAssertEqual(harness.microphoneOpens, 1)
        let reopened = await harness.peer.open()
        XCTAssertTrue(reopened, "an open after the peer stands answers its standing")
        XCTAssertEqual(harness.offers.count, 1)
    }

    @MainActor
    func testAConnectionTheFrameworkCannotBuildFailsTheOpenInWords() async throws {
        struct Refused: LocalizedError {
            var errorDescription: String? { "WebRTC could not build a peer connection." }
        }
        var statuses: [LiveStatus] = []
        var errors: [String] = []
        let peer = LivePeer(
            seams: LivePeerSeams(
                makePeerConnection: { throw Refused() },
                openMicrophone: { FakeTrack() },
                createSession: { _ in nil },
                onStatus: { statuses.append($0) },
                onError: { errors.append($0) }
            )
        )

        let stood = await peer.open()

        XCTAssertFalse(stood)
        XCTAssertEqual(errors, ["WebRTC could not build a peer connection."])
        XCTAssertEqual(statuses, [.connecting, .failed])
        XCTAssertFalse(peer.standing)
    }
}
