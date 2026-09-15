import Foundation

/// The phone's and the watch's transcription of the desktop's contract with
/// the hosted voice service, `packages/hosted/src/live-contract.ts`: the
/// frames the two ends exchange on a voice socket before and beside the Live
/// events, the one handshake header, and the Live client vocabulary the socket
/// may carry. A phone opens the sessions route with a WebRTC offer; a watch,
/// which has no WebRTC, opens the audio route with a format and streams its
/// PCM through the service. `tools/ios-parity` holds every enum here equal to
/// its TypeScript set, and `VoiceServiceContractFixtureTests` holds every
/// frame written or read here to the JSON Schema goldens
/// `packages/hosted/fixtures/json-schema/` and
/// `packages/live/fixtures/json-schema/` commit.

/// `VOICE_SERVICE_FRAME`: the service's own vocabulary on a voice socket. The
/// phone sends `sessionCreate`, `sessionAttach`, `sessionActivity`, and
/// `sessionStop`; the watch the same but `sessionAttach`, since a primary
/// socket has no attach to offer; both read `sessionCreated`,
/// `sessionAttached`, and `sessionSpoken`. `sessionBeat` is the desktop's
/// alone and is transcribed so the set stays whole, never sent.
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
/// Both device routes forward only `close` from this set
/// (`SESSIONS_CLIENT_EVENTS`, `AUDIO_CLIENT_EVENTS`); every append is the
/// service's exchange's, so a device sends `close` and nothing else of it. The
/// watch's audio rides `VoiceServiceContract.inputAudioAppend`, which stands
/// apart from this set as `LIVE_INPUT_AUDIO_APPEND` stands apart from
/// `LIVE_CLIENT_EVENT`.
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
/// session the service records names the phone or the watch that opened it.
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
}

/// `LIVE_AUDIO_ENCODING` in `packages/live/src/session.ts`: the three
/// encodings a primary-socket session may carry, as the format names them.
public enum LiveAudioEncoding: String, CaseIterable, Sendable {
    case pcm16 = "audio/pcm"
    case g711ULaw = "audio/pcmu"
    case g711ALaw = "audio/pcma"
}

/// `LIVE_AUDIO_FORMAT`: the four formats the guide names, each encoding at
/// the one rate the guide pairs it with, keyed as the TypeScript table keys
/// them. One format applies to a session's input and its output alike and is
/// fixed at startup, so what the watch sends its audio as is what Luke's
/// voice comes back as.
public enum LiveAudioFormat: String, CaseIterable, Sendable {
    case pcm16At24k = "PCM16_24K"
    case pcm16At16k = "PCM16_16K"
    case g711ULawAt8k = "G711_ULAW_8K"
    case g711ALawAt8k = "G711_ALAW_8K"

    /// `LIVE_DEFAULT_AUDIO_FORMAT`: the compromise ruled on 2026-09-14 between
    /// the bytes a wrist streams through the service and Luke's own voice.
    /// Changing it is a product decision.
    public static let `default`: LiveAudioFormat = .pcm16At16k

    public var encoding: LiveAudioEncoding {
        switch self {
        case .pcm16At24k, .pcm16At16k: .pcm16
        case .g711ULawAt8k: .g711ULaw
        case .g711ALawAt8k: .g711ALaw
        }
    }

    /// Samples a second.
    public var rate: Int {
        switch self {
        case .pcm16At24k: 24000
        case .pcm16At16k: 16000
        case .g711ULawAt8k: 8000
        case .g711ALawAt8k: 8000
        }
    }

    /// The format as `session.create` carries it: the encoding and the rate, `LiveAudioFormatSchema`'s shape.
    var wire: [String: Any] {
        ["type": encoding.rawValue, "rate": rate]
    }
}

/// The constants of the contract the phone and the watch speak, each named
/// after the TypeScript declaration it transcribes.
public enum VoiceServiceContract {
    /// `VOICE_SERVICE_PATH.SESSIONS`, without its leading slash so it appends to the service URL.
    static let sessionsPath = "api/voice/sessions"
    /// `VOICE_SERVICE_PATH.AUDIO`, the same way: the route a device with no WebRTC streams its audio through.
    static let audioPath = "api/voice/audio"
    /// `LIVE_INPUT_AUDIO_APPEND` in `packages/live/src/session.ts`: the one
    /// client event that carries audio into a session, base64 of raw bytes in
    /// the format the session was started under. The audio route forwards it
    /// from the device; nothing on the sessions route sends it.
    static let inputAudioAppend = "session.input_audio.append"
    /// `LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA` in `packages/live/src/events.ts`:
    /// Luke's audio as the audio route relays it, base64 in `delta`, in the
    /// session's format. The sessions route drops it before the device sees it.
    static let outputAudioDelta = "session.output_audio.delta"
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

/// `SessionAudioCreateFrame`: the watch's opening frame on the audio route,
/// the voice and the one format the session carries in both directions. No
/// offer, since the service's own socket to OpenAI is the transport, and no
/// seed, since the watch seeds nothing as the phone seeds nothing.
public struct SessionAudioCreateFrame: Equatable, Sendable {
    public let voice: LiveVoice
    public let format: LiveAudioFormat

    public init(voice: LiveVoice, format: LiveAudioFormat) {
        self.voice = voice
        self.format = format
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

/// Every frame a device writes to a voice socket: the phone's four service
/// frames and the watch's opening one, the one Live client event both routes
/// forward, and the audio the audio route alone admits.
enum VoiceServiceOutgoingFrame: Equatable, Sendable {
    case create(SessionCreateFrame)
    case createAudio(SessionAudioCreateFrame)
    case attach(SessionAttachFrame)
    case activity(SessionActivityFrame)
    case stop
    case liveClose
    /// One chunk of the device's own audio, already base64, in the format the session was created under.
    case inputAudio(base64: String)

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
        case .createAudio(let frame):
            [
                "type": VoiceServiceFrame.sessionCreate.rawValue,
                "voice": frame.voice.rawValue,
                "format": frame.format.wire,
            ]
        case .attach(let frame):
            ["type": VoiceServiceFrame.sessionAttach.rawValue, "sessionId": frame.sessionId]
        case .activity(let frame):
            ["type": VoiceServiceFrame.sessionActivity.rawValue, "idle": frame.idle]
        case .stop:
            ["type": VoiceServiceFrame.sessionStop.rawValue]
        case .liveClose:
            ["type": LiveClientEventName.close.rawValue]
        case .inputAudio(let base64):
            ["type": VoiceServiceContract.inputAudioAppend, "audio": base64]
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

/// `SessionAudioCreatedFrame`: the service's answer on the audio route, the
/// id the session named itself by in `session.started` and the allowance the
/// session was spent against where the service said. No SDP answer, since
/// nothing negotiated one.
public struct SessionAudioCreatedFrame: Equatable, Sendable {
    public let sessionId: String
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
/// the reader that knows its shape. On the sessions route reflected audio
/// never arrives, since the service drops it before it is relayed; on the
/// audio route Luke's audio is what the device is listening for, and arrives
/// here as `VoiceServiceContract.outputAudioDelta`.
public struct LiveServerEventFrame: Equatable, Sendable {
    public let type: String
    public let payload: JSONValue
}

/// Which of the two device routes a socket stands on, since `session.created`
/// is one type with two shapes and `live-contract.ts` reads each by the route
/// it answers: with an SDP answer on the sessions route, without on the audio
/// route.
enum VoiceServiceRoute: Sendable {
    case sessions
    case audio
}

/// What one text frame from the service is, read the way `live-contract.ts`
/// reads each: a service frame by its own schema with a key a newer service
/// added dropped, a hosted refusal by `hostedErrorSchema`, and anything else
/// naming a type as a relayed Live event.
enum VoiceServiceIncomingFrame: Equatable, Sendable {
    case created(SessionCreatedFrame)
    case audioCreated(SessionAudioCreatedFrame)
    case attached(SessionAttachedFrame)
    case spoken(ProactiveSpeechKind)
    case refused(HostedAPIError, quota: HostedQuota?)
    case liveEvent(LiveServerEventFrame)
    /// Not a JSON document, or a document that is neither a frame of this contract nor a typed event.
    case unreadable

    init(text: String, route: VoiceServiceRoute) {
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
            guard let sessionId = Self.sessionId(members["sessionId"]) else {
                self = .unreadable
                return
            }
            let quota = HostedQuota(json: members["quota"])
            switch route {
            case .audio:
                self = .audioCreated(SessionAudioCreatedFrame(sessionId: sessionId, quota: quota))
            case .sessions:
                guard let sdpAnswer = Self.verbatim(members["sdpAnswer"], maxLength: VoiceServiceContract.sdpMaxLength)
                else {
                    self = .unreadable
                    return
                }
                self = .created(SessionCreatedFrame(sessionId: sessionId, sdpAnswer: sdpAnswer, quota: quota))
            }
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
            // The device's own frames, echoed back by nothing: not an event of the session.
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
