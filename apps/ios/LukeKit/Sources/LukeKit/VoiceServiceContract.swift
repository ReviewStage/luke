import Foundation

/// The phone's transcription of the desktop's contract with the hosted voice
/// service, `packages/hosted/src/live-contract.ts`: the frames the two ends
/// exchange on the sessions socket before and beside the Live events, the one
/// handshake header, and the Live client vocabulary the socket may carry.
/// `tools/ios-parity` holds every enum here equal to its TypeScript set, and
/// `VoiceServiceContractFixtureTests` holds every frame written or read here
/// to the JSON Schema goldens `packages/hosted/fixtures/json-schema/` commits.

/// `VOICE_SERVICE_FRAME`: the service's own vocabulary on the sessions socket.
/// The phone sends `sessionCreate`, `sessionAttach`, `sessionActivity`, and
/// `sessionStop`; it reads `sessionCreated`, `sessionAttached`, and
/// `sessionSpoken`. `sessionBeat` is the desktop's alone and is transcribed so
/// the set stays whole, never sent.
public enum VoiceServiceFrame: String, CaseIterable, Sendable {
    case sessionCreate = "session.create"
    case sessionCreated = "session.created"
    case sessionAttach = "session.attach"
    case sessionAttached = "session.attached"
    case sessionActivity = "session.activity"
    case sessionStop = "session.stop"
    case sessionBeat = "session.beat"
    case sessionSpoken = "session.spoken"
}

/// `LIVE_CLIENT_EVENT` in `packages/live/src/events.ts`, whole: every Live
/// event a client may send, trusted or not. `LiveClientEventType` in
/// `LiveEvents.swift` is the untrusted peer's subset of it, the data channel's
/// vocabulary; this is the set the service socket's grammar is read against.
/// The sessions route forwards only `close` from a device
/// (`SESSIONS_CLIENT_EVENTS`); every append is the service's exchange's, so
/// the phone sends `close` and nothing else of this set.
public enum LiveClientEventName: String, CaseIterable, Sendable {
    case inputAudioMute = "session.input_audio.mute"
    case inputAudioUnmute = "session.input_audio.unmute"
    case instructionsAppend = "session.instructions.append"
    case thinkingAppend = "session.thinking.append"
    case commentaryAppend = "session.commentary.append"
    case close = "session.close"
}

/// `VOICE_SERVICE_HEADER`: the one header beside the bearer on a
/// `session.create` handshake, naming this installation's device row so the
/// session the service records names the phone that opened it.
public enum VoiceServiceHeader: String, CaseIterable, Sendable {
    case deviceId = "x-luke-device-id"
}

/// `PROACTIVE_SPEECH_KIND` in `packages/live/src/proactive.ts`: what a
/// `session.spoken` frame says was spoken to its end.
public enum ProactiveSpeechKind: String, CaseIterable, Sendable {
    case briefing
    case arrival
    case calendarOnboarding = "calendar-onboarding"
    case launch
    case voicePreview = "voice-preview"
}

/// The constants of the contract the phone speaks, each named after the
/// TypeScript declaration it transcribes.
public enum VoiceServiceContract {
    /// `VOICE_SERVICE_PATH.SESSIONS`, without its leading slash so it appends to the service URL.
    static let sessionsPath = "api/voice/sessions"
    /// `LIVE_IDLE_WINDOW_MS`: how long a quiet peer stands before it reports itself idle.
    public static let liveIdleWindowMs = 300000
    /// `HOSTED_REATTACH_DELAYS_MS`: the waits before each try at re-attaching a lost connection.
    public static let reattachDelaysMs = [0, 3000, 7000]
    /// `SESSION_CREATE_BOUNDS.SDP_CHARS`: the bound on an offer or answer.
    static let sdpMaxLength = 65536
    /// The bound on a session id, `SESSION_ID_CHARS` in the contract.
    static let sessionIdMaxLength = 256
}

// MARK: - Frames the phone sends

/// `SessionCreateFrame`: the offer, the voice, and an empty seed, since the
/// phone seeds nothing as the desktop seeds nothing.
public struct SessionCreateFrame: Equatable, Sendable {
    public let sdp: String
    public let voice: LiveVoice

    public init(sdp: String, voice: LiveVoice) {
        self.sdp = sdp
        self.voice = voice
    }
}

/// `SessionAttachFrame`: the opening frame of a fresh connection to a session that stands.
public struct SessionAttachFrame: Equatable, Sendable {
    public let sessionId: String

    public init(sessionId: String) {
        self.sessionId = sessionId
    }
}

/// `SessionActivityFrame`: whether the peer has gone quiet, as its own idle window read it.
public struct SessionActivityFrame: Equatable, Sendable {
    public let idle: Bool

    public init(idle: Bool) {
        self.idle = idle
    }
}

/// Every frame the phone writes to the sessions socket: the four service
/// frames it may send and the one Live client event the route forwards.
enum VoiceServiceOutgoingFrame: Equatable, Sendable {
    case create(SessionCreateFrame)
    case attach(SessionAttachFrame)
    case activity(SessionActivityFrame)
    case stop
    case liveClose

    /// The frame as the bytes the socket carries. Keys are sorted so the same
    /// frame is always the same text, and slashes stay as an SDP wrote them.
    var text: String {
        let data = try? JSONSerialization.data(
            withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]
        )
        return String(decoding: data ?? Data(), as: UTF8.self)
    }

    private var object: [String: Any] {
        switch self {
        case .create(let frame):
            [
                "type": VoiceServiceFrame.sessionCreate.rawValue,
                "sdp": frame.sdp,
                "voice": frame.voice.rawValue,
                "input": [Any](),
            ]
        case .attach(let frame):
            ["type": VoiceServiceFrame.sessionAttach.rawValue, "sessionId": frame.sessionId]
        case .activity(let frame):
            ["type": VoiceServiceFrame.sessionActivity.rawValue, "idle": frame.idle]
        case .stop:
            ["type": VoiceServiceFrame.sessionStop.rawValue]
        case .liveClose:
            ["type": LiveClientEventName.close.rawValue]
        }
    }
}

// MARK: - Frames the phone reads

/// `SessionCreatedFrame`: the session's opaque id, the SDP answer to set as the
/// remote description, and the allowance the session was spent against where
/// the service said.
public struct SessionCreatedFrame: Equatable, Sendable {
    public let sessionId: String
    public let sdpAnswer: String
    public let quota: HostedQuota?
}

/// `SessionAttachedFrame`: the sideband stands again on the session named.
public struct SessionAttachedFrame: Equatable, Sendable {
    public let sessionId: String
}

/// `HostedQuota` in `service-wire.ts`: the account's allowance as a refusal
/// or a creation reports it.
public struct HostedQuota: Equatable, Sendable {
    public let used: Double
    public let limit: Double
    public let resetsAt: Double

    /// A quota is read whole or not at all, each count a non-negative number.
    init?(json: JSONValue?) {
        guard let used = json?["used"]?.numberValue, used >= 0,
              let limit = json?["limit"]?.numberValue, limit >= 0,
              let resetsAt = json?["resetsAt"]?.numberValue, resetsAt >= 0
        else { return nil }
        self.used = used
        self.limit = limit
        self.resetsAt = resetsAt
    }
}

/// A Live server event the service relayed as the session emitted it: its
/// type, which is the protocol's own discriminant, and the whole document for
/// the reader that knows its shape. Reflected audio never arrives; the service
/// drops it before it is relayed.
public struct LiveServerEventFrame: Equatable, Sendable {
    public let type: String
    public let payload: JSONValue
}

/// What one text frame from the service is, read the way `live-contract.ts`
/// reads each: a service frame by its own schema with a key a newer service
/// added dropped, a hosted refusal by `hostedErrorSchema`, and anything else
/// naming a type as a relayed Live event.
enum VoiceServiceIncomingFrame: Equatable, Sendable {
    case created(SessionCreatedFrame)
    case attached(SessionAttachedFrame)
    case spoken(ProactiveSpeechKind)
    case refused(HostedAPIError, quota: HostedQuota?)
    case liveEvent(LiveServerEventFrame)
    /// Not a JSON document, or a document that is neither a frame of this contract nor a typed event.
    case unreadable

    init(text: String) {
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)),
              case .object(let members) = value
        else {
            self = .unreadable
            return
        }
        if let reason = members["error"]?.stringValue.flatMap({ HostedAPIError(rawValue: $0.trimmed) }) {
            self = .refused(reason, quota: HostedQuota(json: members["quota"]))
            return
        }
        guard let type = members["type"]?.stringValue else {
            self = .unreadable
            return
        }
        switch VoiceServiceFrame(rawValue: type) {
        case .sessionCreated:
            guard let sessionId = Self.sessionId(members["sessionId"]),
                  let sdpAnswer = Self.verbatim(members["sdpAnswer"], maxLength: VoiceServiceContract.sdpMaxLength)
            else {
                self = .unreadable
                return
            }
            self = .created(
                SessionCreatedFrame(
                    sessionId: sessionId, sdpAnswer: sdpAnswer, quota: HostedQuota(json: members["quota"])
                )
            )
        case .sessionAttached:
            guard let sessionId = Self.sessionId(members["sessionId"]) else {
                self = .unreadable
                return
            }
            self = .attached(SessionAttachedFrame(sessionId: sessionId))
        case .sessionSpoken:
            guard let kind = members["kind"]?.stringValue.flatMap(ProactiveSpeechKind.init(rawValue:)) else {
                self = .unreadable
                return
            }
            self = .spoken(kind)
        case .sessionCreate, .sessionAttach, .sessionActivity, .sessionStop, .sessionBeat:
            // The phone's own frames, echoed back by nothing: not an event of the session.
            self = .unreadable
        case nil:
            self = .liveEvent(LiveServerEventFrame(type: type, payload: value))
        }
    }

    /// A session id as `text(SESSION_ID_CHARS)` reads it: trimmed, non-empty, bounded.
    private static func sessionId(_ value: JSONValue?) -> String? {
        guard let text = value?.stringValue?.trimmed, !text.isEmpty,
              text.utf16.count <= VoiceServiceContract.sessionIdMaxLength
        else { return nil }
        return text
    }

    /// An SDP as `verbatimText` reads it: as written, bounded, refused when
    /// only whitespace. The bound counts UTF-16 units, as the service's
    /// `isMaxLength` does over a JavaScript string, so a `\r\n` an SDP line
    /// ends with is two and not one grapheme.
    private static func verbatim(_ value: JSONValue?, maxLength: Int) -> String? {
        guard let text = value?.stringValue, text.utf16.count <= maxLength, !text.trimmed.isEmpty else { return nil }
        return text
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
