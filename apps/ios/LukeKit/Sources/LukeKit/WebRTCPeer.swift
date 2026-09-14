#if canImport(LiveKitWebRTC)
import Foundation
import LiveKitWebRTC

// The one file that imports the WebRTC binary, and the only one that may:
// `LivePeer` drives the seams this file answers, so the state machine and
// its tests compile wherever Swift does and this file compiles only where the
// framework is linked. The watch target never links it — the framework has
// no watchOS slice — and `#if canImport` is what keeps a watch build from
// reaching it. Every callback the framework raises on its own threads is
// hopped onto the main actor before the peer sees it.
//
// Capture and playback are the framework's own audio device module: the
// microphone track's source is the device's input, and a remote track plays
// through its output for as long as the track is enabled, with the audio
// session configured by the module when the peer stands. Nothing here reads a
// sample; the bytes that cross the process boundary are the SDP and the
// channel's JSON, and neither is logged.

/// Why the framework could not build what the peer asked for.
public enum WebRTCPeerFailure: Error, Equatable, Sendable, LocalizedError {
    case noPeerConnection
    case noDataChannel
    case noSender
    case foreignTrack

    public var errorDescription: String? {
        switch self {
        case .noPeerConnection: "WebRTC could not build a peer connection."
        case .noDataChannel: "WebRTC could not open the event channel."
        case .noSender: "WebRTC could not put the microphone on the line."
        case .foreignTrack: "The track handed to the peer connection was not one of its own."
        }
    }
}

/// A phone's two peer seams, from one `RTCPeerConnectionFactory`: the
/// factory owns the audio device module, so the connection and the
/// microphone it builds share the one capture and playout path.
@MainActor
public final class WebRTCPeerFactory {
    private let factory = LKRTCPeerConnectionFactory()

    public init() {}

    public func makePeerConnection() throws -> any LivePeerConnection {
        try WebRTCPeerConnection(factory: factory)
    }

    /// The microphone as a track: its source is the audio device module's
    /// input, so the framework's audio session carries the capture.
    public func openMicrophone() throws -> any LiveAudioTrack {
        let source = factory.audioSource(with: nil)
        return WebRTCAudioTrack(factory.audioTrack(with: source, trackId: UUID().uuidString))
    }
}

/// An object of the framework's crossing from the thread it was raised on to
/// the main actor, where the peer reads it. The framework hands each out once
/// and never touches it again, which is what makes the crossing sound.
private struct Crossing<Value>: @unchecked Sendable {
    let value: Value
}

@MainActor
final class WebRTCAudioTrack: LiveAudioTrack {
    let track: LKRTCAudioTrack

    init(_ track: LKRTCAudioTrack) {
        self.track = track
    }

    var isEnabled: Bool {
        get { track.isEnabled }
        set { track.isEnabled = newValue }
    }
}

@MainActor
final class WebRTCDataChannel: NSObject, LiveDataChannel, LKRTCDataChannelDelegate {
    private let channel: LKRTCDataChannel
    var onMessage: ((String) -> Void)?
    var onClose: (() -> Void)?

    init(_ channel: LKRTCDataChannel) {
        self.channel = channel
        super.init()
        channel.delegate = self
    }

    var isOpen: Bool { channel.readyState == .open }

    @discardableResult
    func send(_ text: String) -> Bool {
        channel.sendData(LKRTCDataBuffer(data: Data(text.utf8), isBinary: false))
    }

    func close() {
        channel.close()
    }

    nonisolated func dataChannelDidChangeState(_ dataChannel: LKRTCDataChannel) {
        guard dataChannel.readyState == .closed else { return }
        Task { @MainActor in self.onClose?() }
    }

    nonisolated func dataChannel(_ dataChannel: LKRTCDataChannel, didReceiveMessageWith buffer: LKRTCDataBuffer) {
        guard !buffer.isBinary, let text = String(data: buffer.data, encoding: .utf8) else { return }
        Task { @MainActor in self.onMessage?(text) }
    }
}

@MainActor
final class WebRTCPeerConnection: NSObject, LivePeerConnection, LKRTCPeerConnectionDelegate {
    /// The one stream the microphone rides; the id is the SDP's `msid` and names nothing.
    private static let microphoneStreamId = "microphone"

    private let connection: LKRTCPeerConnection
    var onIceGatheringStateChange: (() -> Void)?
    var onTransportStateChange: (() -> Void)?
    var onRemoteTrack: ((any LiveAudioTrack) -> Void)?

    init(factory: LKRTCPeerConnectionFactory) throws {
        let configuration = LKRTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        guard let connection = factory.peerConnection(
            with: configuration,
            constraints: Self.noConstraints,
            delegate: nil
        ) else { throw WebRTCPeerFailure.noPeerConnection }
        self.connection = connection
        super.init()
        connection.delegate = self
    }

    private static var noConstraints: LKRTCMediaConstraints {
        LKRTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
    }

    var transportState: LiveTransportState? {
        switch connection.connectionState {
        case .new: nil
        case .connecting: .connecting
        case .connected: .connected
        case .disconnected: .disconnected
        case .failed: .failed
        case .closed: .closed
        @unknown default: nil
        }
    }

    var iceGatheringComplete: Bool { connection.iceGatheringState == .complete }

    var localDescription: LiveSessionDescription? {
        connection.localDescription.map { LiveSessionDescription(kind: Self.kind(of: $0.type), sdp: $0.sdp) }
    }

    func addAudioTrack(_ track: any LiveAudioTrack) throws {
        guard let audio = track as? WebRTCAudioTrack else { throw WebRTCPeerFailure.foreignTrack }
        guard connection.add(audio.track, streamIds: [Self.microphoneStreamId]) != nil else {
            throw WebRTCPeerFailure.noSender
        }
    }

    func createDataChannel(label: String) throws -> any LiveDataChannel {
        guard let channel = connection.dataChannel(forLabel: label, configuration: LKRTCDataChannelConfiguration())
        else { throw WebRTCPeerFailure.noDataChannel }
        return WebRTCDataChannel(channel)
    }

    func createOffer() async throws -> LiveSessionDescription {
        let connection = self.connection
        let offer: Crossing<LKRTCSessionDescription> = try await withCheckedThrowingContinuation { continuation in
            connection.offer(for: Self.noConstraints) { description, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let description {
                    continuation.resume(returning: Crossing(value: description))
                } else {
                    continuation.resume(throwing: LivePeerFailure.noLocalDescription)
                }
            }
        }
        return LiveSessionDescription(kind: Self.kind(of: offer.value.type), sdp: offer.value.sdp)
    }

    func setLocalDescription(_ description: LiveSessionDescription) async throws {
        let connection = self.connection
        let native = LKRTCSessionDescription(type: Self.type(of: description.kind), sdp: description.sdp)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.setLocalDescription(native) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    func setRemoteDescription(_ description: LiveSessionDescription) async throws {
        let connection = self.connection
        let native = LKRTCSessionDescription(type: Self.type(of: description.kind), sdp: description.sdp)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.setRemoteDescription(native) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }

    func close() {
        connection.close()
    }

    private static func kind(of type: LKRTCSdpType) -> LiveSessionDescription.Kind {
        switch type {
        case .offer: .offer
        case .prAnswer: .prAnswer
        case .answer: .answer
        case .rollback: .rollback
        @unknown default: .offer
        }
    }

    private static func type(of kind: LiveSessionDescription.Kind) -> LKRTCSdpType {
        switch kind {
        case .offer: .offer
        case .prAnswer: .prAnswer
        case .answer: .answer
        case .rollback: .rollback
        }
    }

    // MARK: - LKRTCPeerConnectionDelegate

    nonisolated func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange newState: LKRTCPeerConnectionState) {
        Task { @MainActor in self.onTransportStateChange?() }
    }

    nonisolated func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange newState: LKRTCIceGatheringState) {
        Task { @MainActor in self.onIceGatheringStateChange?() }
    }

    nonisolated func peerConnection(
        _ peerConnection: LKRTCPeerConnection,
        didAdd rtpReceiver: LKRTCRtpReceiver,
        streams mediaStreams: [LKRTCMediaStream]
    ) {
        guard let track = rtpReceiver.track as? LKRTCAudioTrack else { return }
        let crossing = Crossing(value: track)
        Task { @MainActor in self.onRemoteTrack?(WebRTCAudioTrack(crossing.value)) }
    }

    nonisolated func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange stateChanged: LKRTCSignalingState) {}

    nonisolated func peerConnection(_ peerConnection: LKRTCPeerConnection, didAdd stream: LKRTCMediaStream) {}

    nonisolated func peerConnection(_ peerConnection: LKRTCPeerConnection, didRemove stream: LKRTCMediaStream) {}

    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: LKRTCPeerConnection) {}

    nonisolated func peerConnection(_ peerConnection: LKRTCPeerConnection, didChange newState: LKRTCIceConnectionState) {}

    nonisolated func peerConnection(_ peerConnection: LKRTCPeerConnection, didGenerate candidate: LKRTCIceCandidate) {}

    nonisolated func peerConnection(_ peerConnection: LKRTCPeerConnection, didRemove candidates: [LKRTCIceCandidate]) {}

    nonisolated func peerConnection(_ peerConnection: LKRTCPeerConnection, didOpen dataChannel: LKRTCDataChannel) {}
}
#endif
