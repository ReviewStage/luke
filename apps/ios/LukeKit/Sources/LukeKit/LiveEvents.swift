import Foundation

/// The client events the device may send on its data channel —
/// `RENDERER_CLIENT_EVENTS` in `packages/live/src/events.ts`, the subset of
/// `LIVE_CLIENT_EVENT` an untrusted peer is allowed: the microphone switch and
/// the hang-up, and nothing that appends to the model. Every append is the
/// service's, over its sideband. Nothing here starts a session either: the
/// request that created the WebRTC session started it, and `session.start`
/// must not go on the channel.
public enum LiveClientEventType: String, CaseIterable, Sendable {
    case inputAudioMute = "session.input_audio.mute"
    case inputAudioUnmute = "session.input_audio.unmute"
    case close = "session.close"
}

/// One event the device sends: its type and the id of its own, which the
/// acknowledgment or the error about it names back as `client_event_id`.
public struct LiveClientEvent: Equatable, Sendable {
    public let type: LiveClientEventType
    public let eventId: String

    public init(type: LiveClientEventType, eventId: String) {
        self.type = type
        self.eventId = eventId
    }

    /// Mutes the developer's input; the acknowledgment is `session.input_audio.muted`. Output continues.
    public static func mute(eventId: String) -> LiveClientEvent {
        LiveClientEvent(type: .inputAudioMute, eventId: eventId)
    }

    /// Resumes the developer's input; the acknowledgment is `session.input_audio.unmuted`.
    public static func unmute(eventId: String) -> LiveClientEvent {
        LiveClientEvent(type: .inputAudioUnmute, eventId: eventId)
    }

    /// Asks the session to finish; `session.closed` is awaited before anything is torn down.
    public static func close(eventId: String) -> LiveClientEvent {
        LiveClientEvent(type: .close, eventId: eventId)
    }

    /// The record as the channel carries it: `type` and `event_id`, and nothing else.
    public var payload: String {
        let record: [String: String] = ["type": type.rawValue, "event_id": eventId]
        guard let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8)
        else { return "" }
        return text
    }
}

/// The server events the device's data channel is shown —
/// `RENDERER_SERVER_EVENTS` in `packages/live/src/events.ts`: the lifecycle,
/// both captions, the device's own microphone acknowledgments, usage, and the
/// error and info events. Delegations and append acknowledgments are the
/// service's business and stay off the channel.
public enum LiveServerEventType: String, CaseIterable, Sendable {
    case sessionStarted = "session.started"
    case sessionClosed = "session.closed"
    case inputTranscriptDelta = "session.input_transcript.delta"
    case outputTranscriptDelta = "session.output_transcript.delta"
    case inputAudioMuted = "session.input_audio.muted"
    case inputAudioUnmuted = "session.input_audio.unmuted"
    case usageUpdated = "session.usage.updated"
    case error
    case info
}

/// Why a session ended, as `session.closed` names it — `LIVE_CLOSE_REASON` in
/// `packages/live/src/events.ts`.
public enum LiveCloseReason: String, Sendable {
    case closeRequested = "close_requested"
    case expired
    case content
    case remoteHangup = "remote_hangup"
    case connectionLost = "connection_lost"
}

/// One transcript fragment exactly as received, with its interval on the
/// session timeline. The captions recipe forbids trimming a fragment or
/// inserting a space between two, so a delta of one space is a delta.
public struct LiveTranscriptDelta: Equatable, Sendable {
    public let eventId: String
    public let delta: String
    public let startMs: Int
    public let endMs: Int

    public init(eventId: String, delta: String, startMs: Int, endMs: Int) {
        self.eventId = eventId
        self.delta = delta
        self.startMs = startMs
        self.endMs = endMs
    }
}

/// What an `error` event says about itself. Every field may be absent, and
/// the command it is about may be named at the event's top level or in here,
/// so a reader matches on whichever arrived.
public struct LiveErrorDetail: Equatable, Sendable {
    public let code: String?
    public let message: String?
    public let clientEventId: String?

    public init(code: String? = nil, message: String? = nil, clientEventId: String? = nil) {
        self.code = code
        self.message = message
        self.clientEventId = clientEventId
    }
}

/// One inbound event as the device reads it, in the grammar
/// `liveServerEventSchema` in `packages/live/src/events.ts` declares: an
/// event outside `LiveServerEventType`, or one missing a field its schema
/// requires, is discarded rather than repaired, and a key the declaration
/// does not name is dropped.
public enum LiveServerEvent: Equatable, Sendable {
    case sessionStarted(eventId: String, sessionId: String)
    case sessionClosed(eventId: String, reason: LiveCloseReason, usageSeconds: Double)
    case inputTranscriptDelta(LiveTranscriptDelta)
    case outputTranscriptDelta(LiveTranscriptDelta)
    case inputAudioMuted(eventId: String, clientEventId: String?)
    case inputAudioUnmuted(eventId: String, clientEventId: String?)
    case usageUpdated(eventId: String, usageSeconds: Double)
    case error(eventId: String, clientEventId: String?, detail: LiveErrorDetail)
    case info(eventId: String, code: String?, message: String?)

    public var type: LiveServerEventType {
        switch self {
        case .sessionStarted: .sessionStarted
        case .sessionClosed: .sessionClosed
        case .inputTranscriptDelta: .inputTranscriptDelta
        case .outputTranscriptDelta: .outputTranscriptDelta
        case .inputAudioMuted: .inputAudioMuted
        case .inputAudioUnmuted: .inputAudioUnmuted
        case .usageUpdated: .usageUpdated
        case .error: .error
        case .info: .info
        }
    }

    /// The client event this one answers or refuses, when it names one.
    public var clientEventId: String? {
        switch self {
        case .inputAudioMuted(_, let clientEventId), .inputAudioUnmuted(_, let clientEventId):
            clientEventId
        case .error(_, let clientEventId, let detail):
            clientEventId ?? detail.clientEventId
        default:
            nil
        }
    }

    /// Reads one data-channel payload: JSON text, or nothing for anything the
    /// grammar refuses.
    public init?(payload text: String) {
        guard let json = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)),
              case .object = json,
              let type = json["type"]?.stringValue.flatMap(LiveServerEventType.init(rawValue:)),
              let eventId = json["event_id"].flatMap(LiveServerEvent.opaqueId)
        else { return nil }
        // A `client_event_id` that arrived malformed refuses the event, as the
        // schema's optional key does; one that did not arrive is nothing.
        let clientEventId: String?
        if let carried = json["client_event_id"] {
            guard let id = LiveServerEvent.opaqueId(carried) else { return nil }
            clientEventId = id
        } else {
            clientEventId = nil
        }
        switch type {
        case .sessionStarted:
            guard let sessionId = json["session"]?["id"].flatMap(LiveServerEvent.opaqueId) else { return nil }
            self = .sessionStarted(eventId: eventId, sessionId: sessionId)
        case .sessionClosed:
            guard let reason = json["reason"]?.stringValue.flatMap(LiveCloseReason.init(rawValue:)),
                  let seconds = json["usage"]?["seconds"].flatMap(LiveServerEvent.nonNegative)
            else { return nil }
            self = .sessionClosed(eventId: eventId, reason: reason, usageSeconds: seconds)
        case .inputTranscriptDelta, .outputTranscriptDelta:
            guard let delta = json["delta"]?.stringValue,
                  let startMs = json["start_ms"].flatMap(LiveServerEvent.sessionTimeMs),
                  let endMs = json["end_ms"].flatMap(LiveServerEvent.sessionTimeMs)
            else { return nil }
            let fragment = LiveTranscriptDelta(eventId: eventId, delta: delta, startMs: startMs, endMs: endMs)
            self = type == .inputTranscriptDelta ? .inputTranscriptDelta(fragment) : .outputTranscriptDelta(fragment)
        case .inputAudioMuted:
            self = .inputAudioMuted(eventId: eventId, clientEventId: clientEventId)
        case .inputAudioUnmuted:
            self = .inputAudioUnmuted(eventId: eventId, clientEventId: clientEventId)
        case .usageUpdated:
            guard let seconds = json["usage"]?["seconds"].flatMap(LiveServerEvent.nonNegative) else { return nil }
            self = .usageUpdated(eventId: eventId, usageSeconds: seconds)
        case .error:
            guard let error = json["error"], case .object = error else { return nil }
            self = .error(
                eventId: eventId,
                clientEventId: clientEventId,
                detail: LiveErrorDetail(
                    code: error["code"].flatMap(LiveServerEvent.text),
                    message: error["message"].flatMap(LiveServerEvent.text),
                    clientEventId: error["client_event_id"].flatMap(LiveServerEvent.opaqueId)
                )
            )
        case .info:
            self = .info(
                eventId: eventId,
                code: json["code"].flatMap(LiveServerEvent.text),
                message: json["message"].flatMap(LiveServerEvent.text)
            )
        }
    }

    /// An identifier as the service wrote it, prefix included; only a blank one is refused.
    private static func opaqueId(_ value: JSONValue) -> String? {
        guard let id = value.stringValue, !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return id
    }

    /// A trimmed text, dropped when only whitespace remains.
    private static func text(_ value: JSONValue) -> String? {
        guard let trimmed = value.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    /// A finite, non-negative number.
    private static func nonNegative(_ value: JSONValue) -> Double? {
        guard let number = value.numberValue, number.isFinite, number >= 0 else { return nil }
        return number
    }

    /// Milliseconds on the session timeline: a non-negative integer.
    private static func sessionTimeMs(_ value: JSONValue) -> Int? {
        guard let number = nonNegative(value), number == number.rounded(), number <= Double(Int.max) else {
            return nil
        }
        return Int(number)
    }
}
