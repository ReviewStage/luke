import Foundation

// MARK: - Audio seam protocols

/// Source of 24 kHz PCM16 mono audio from the microphone. Injected so tests
/// can substitute a silent or scripted source without audio hardware.
public protocol AudioCapturer: Sendable {
    /// Starts capturing. Chunks arrive on the returned stream until `stop()`.
    func start() throws -> AsyncStream<[Int16]>
    func stop()
}

/// Sink for 24 kHz PCM16 mono audio to the speaker. Injected so tests can
/// substitute a no-op sink without audio hardware.
public protocol AudioPlayer: Sendable {
    /// Queues raw PCM16 samples for playback.
    func enqueue(_ samples: [Int16])
    func stop()
}

// MARK: - WebSocket seam

/// The channel the realtime session writes to and reads from. Injected so tests
/// can substitute a scripted channel without a live OpenAI WebSocket.
public protocol WebSocketTask: Sendable {
    func resume()
    func sendText(_ text: String) async throws
    func receiveText() async throws -> String
    func close()
}

// MARK: - Status

public enum RealtimeStatus: Sendable, Equatable {
    /// Not connected — the starting state and the state after `close()`.
    case idle
    /// WebSocket handshake in progress.
    case connecting
    /// Connected and waiting for the developer to press the talk button.
    case ready
    /// Recording the developer's voice.
    case listening
    /// Turn committed; waiting for the model to respond.
    case thinking
    /// Playing the model's audio response.
    case speaking
}

// MARK: - Options

public struct RealtimeSessionOptions: Sendable {
    /// Mints the Realtime connection. Called once on connect.
    public var requestConnection: @Sendable () async throws -> VoiceConnection

    /// Called on each status change. Always delivered on the main actor.
    public var onStatus: @MainActor (RealtimeStatus) -> Void
    /// Called with the running caption text while the model speaks, nil when done. Always delivered on the main actor.
    public var onCaption: @MainActor (String?) -> Void
    /// Called with the developer's transcribed words when a turn ends. Always delivered on the main actor.
    public var onSpokenAsk: (@MainActor (String) -> Void)?
    /// Called with an error description when the session closes unexpectedly. Always delivered on the main actor.
    public var onError: @MainActor (String?) -> Void

    /// Dispatches an armed tool call to the appropriate hosted act endpoint.
    /// Receives the tool name, the parsed arguments, and the call id; returns
    /// the JSON string to send back as `function_call_output`. Called only in
    /// turns the developer explicitly opened (press or typed ask).
    public var dispatchToolCall: (@Sendable @MainActor (
        _ name: String,
        _ arguments: [String: Any],
        _ callId: String
    ) async -> String)?

    /// Overrides the WebSocket factory for tests. When nil, the session opens
    /// a URLSessionWebSocketTask to `connection.wsURL` with the ephemeral key.
    public var makeWebSocket: (@Sendable (URL, String) -> any WebSocketTask)?

    /// Provides the audio capturer for each turn. Required — the session has
    /// no default so the app target can keep AVFoundation out of LukeKit's tests.
    public var makeAudioCapturer: @Sendable () -> any AudioCapturer

    /// Provides the audio player for each response. Required for the same reason.
    public var makeAudioPlayer: @Sendable () -> any AudioPlayer

    /// How long the session may sit idle (no turns started) before closing.
    /// Default is 180 seconds (3 minutes), matching the desktop.
    public var idleTimeoutSeconds: Double

    public init(
        requestConnection: @Sendable @escaping () async throws -> VoiceConnection,
        onStatus: @MainActor @escaping (RealtimeStatus) -> Void,
        onCaption: @MainActor @escaping (String?) -> Void,
        onSpokenAsk: (@MainActor (String) -> Void)? = nil,
        onError: @MainActor @escaping (String?) -> Void,
        dispatchToolCall: (
            @Sendable @MainActor (_ name: String, _ arguments: [String: Any], _ callId: String) async -> String
        )? = nil,
        makeWebSocket: (@Sendable (URL, String) -> any WebSocketTask)? = nil,
        makeAudioCapturer: @Sendable @escaping () -> any AudioCapturer,
        makeAudioPlayer: @Sendable @escaping () -> any AudioPlayer,
        idleTimeoutSeconds: Double = 180
    ) {
        self.requestConnection = requestConnection
        self.onStatus = onStatus
        self.onCaption = onCaption
        self.onSpokenAsk = onSpokenAsk
        self.onError = onError
        self.dispatchToolCall = dispatchToolCall
        self.makeWebSocket = makeWebSocket
        self.makeAudioCapturer = makeAudioCapturer
        self.makeAudioPlayer = makeAudioPlayer
        self.idleTimeoutSeconds = idleTimeoutSeconds
    }
}

// MARK: - RealtimeSession

/// UIKit-free push-to-talk voice session over OpenAI Realtime's WebSocket
/// transport. Mirrors the desktop's armed-turn discipline: tool calls are
/// dispatched only in turns the developer explicitly opened with a press or
/// typed ask. Audio capture and playback are injected as seams so the class
/// and its tests stay free of audio hardware.
@MainActor
public final class RealtimeSession {
    private let options: RealtimeSessionOptions

    public private(set) var status: RealtimeStatus = .idle {
        didSet { if status != oldValue { options.onStatus(status) } }
    }

    private var channel: (any WebSocketTask)?
    private var capturer: (any AudioCapturer)?
    private var player: (any AudioPlayer)?
    private var pressBuffer = PressAudioBuffer()

    // True during a turn the developer explicitly opened; cleared after
    // response.done so only that one response may dispatch tool calls.
    private var isArmed = false
    // Set when the developer releases while still connecting, so we commit
    // and request a response the moment the channel opens.
    private var pendingCommit = false

    private var receiveTask: Task<Void, Never>?
    private var captureTask: Task<Void, Never>?
    private var idleTask: Task<Void, Never>?

    private var pendingCalls: [String: (name: String, args: String)] = [:]
    private var captionBuffer = ""

    public init(options: RealtimeSessionOptions) {
        self.options = options
    }

    // MARK: - Public API

    public func connect() async {
        guard status == .idle else { return }
        status = .connecting
        do {
            let connection = try await options.requestConnection()
            let ws: any WebSocketTask
            if let factory = options.makeWebSocket {
                ws = factory(connection.wsURL, connection.ephemeralKey)
            } else {
                ws = URLSessionWebSocketChannel(
                    url: connection.wsURL, bearerToken: connection.ephemeralKey
                )
            }
            channel = ws
            ws.resume()
            receiveTask = Task { [weak self] in
                await self?.runReceiveLoop(ws: ws, context: connection.sessionsContext)
            }
        } catch {
            status = .idle
            options.onError(error.localizedDescription)
        }
    }

    /// Called when the developer presses and holds the talk button.
    public func beginTurn() {
        guard status == .connecting || status == .ready else { return }
        isArmed = true
        resetIdleTimer()
        startCapturing()
        if status == .ready { status = .listening }
    }

    /// Called when the developer releases the talk button.
    public func endTurn() {
        switch status {
        case .connecting:
            stopCapturing()
            pendingCommit = true
        case .listening:
            stopCapturing()
            status = .thinking
            Task { [weak self] in await self?.commitAndRequestResponse() }
        default:
            break
        }
    }

    /// Closes the connection and resets to idle.
    public func close() {
        idleTask?.cancel(); idleTask = nil
        receiveTask?.cancel(); receiveTask = nil
        stopCapturing()
        player?.stop(); player = nil
        channel?.close(); channel = nil
        isArmed = false
        pendingCommit = false
        pendingCalls.removeAll()
        captionBuffer = ""
        status = .idle
        options.onCaption(nil)
    }

    // MARK: - Audio

    private func startCapturing() {
        captureTask?.cancel()
        let c = options.makeAudioCapturer()
        capturer = c
        captureTask = Task { [weak self] in
            guard let stream = try? c.start() else { return }
            for await chunk in stream {
                guard let self else { return }
                switch self.status {
                case .connecting:
                    self.pressBuffer.push(chunk)
                case .listening:
                    guard let ch = self.channel else { break }
                    let msg = self.audioAppendJSON(chunk)
                    try? await ch.sendText(msg)
                default:
                    break
                }
            }
        }
    }

    private func stopCapturing() {
        captureTask?.cancel(); captureTask = nil
        capturer?.stop(); capturer = nil
    }

    private func commitAndRequestResponse() async {
        guard let ws = channel else { return }
        try? await ws.sendText(#"{"type":"input_audio_buffer.commit"}"#)
        try? await ws.sendText(#"{"type":"response.create"}"#)
    }

    // MARK: - Receive loop

    private func runReceiveLoop(ws: any WebSocketTask, context: VoiceContextItem) async {
        var channelOpen = false
        while !Task.isCancelled {
            do {
                let text = try await ws.receiveText()
                let json = (try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]) ?? [:]
                let type = json["type"] as? String ?? ""
                if !channelOpen {
                    guard type == "session.created" || type == "session.updated" else { continue }
                    channelOpen = true
                    await onChannelOpen(ws: ws, context: context)
                    continue
                }
                await handleEvent(type: type, json: json, ws: ws)
            } catch {
                if !Task.isCancelled {
                    let message = (error as? URLError)?.localizedDescription ?? error.localizedDescription
                    options.onError(message)
                    close()
                }
                return
            }
        }
    }

    private func onChannelOpen(ws: any WebSocketTask, context: VoiceContextItem) async {
        try? await ws.sendText(contextItemJSON(context))
        for chunk in pressBuffer.drain() {
            try? await ws.sendText(audioAppendJSON(chunk))
        }
        if pendingCommit {
            pendingCommit = false
            status = .thinking
            await commitAndRequestResponse()
        } else if isArmed {
            // Capture already running; status tracks listening once the first chunk arrives.
            status = .listening
        } else {
            status = .ready
            resetIdleTimer()
        }
    }

    private func handleEvent(type: String, json: [String: Any], ws: any WebSocketTask) async {
        switch type {

        case "response.audio.delta":
            if player == nil { player = options.makeAudioPlayer() }
            if status != .speaking { status = .speaking }
            if let b64 = json["delta"] as? String, let data = Data(base64Encoded: b64) {
                let samples = data.withUnsafeBytes { ptr in Array(ptr.bindMemory(to: Int16.self)) }
                player?.enqueue(samples)
            }

        case "output_audio_buffer.stopped":
            player?.stop(); player = nil
            if status == .speaking {
                status = .ready
                resetIdleTimer()
            }

        case "response.audio_transcript.delta":
            if let delta = json["delta"] as? String {
                captionBuffer += delta
                options.onCaption(captionBuffer)
            }

        case "response.audio_transcript.done":
            captionBuffer = ""
            options.onCaption(nil)

        case "response.output_item.added":
            if let item = json["item"] as? [String: Any],
               item["type"] as? String == "function_call",
               let callId = item["call_id"] as? String,
               let name = item["name"] as? String
            {
                pendingCalls[callId] = (name: name, args: "")
            }

        case "response.function_call_arguments.delta":
            if let callId = json["call_id"] as? String, let delta = json["delta"] as? String {
                pendingCalls[callId]?.args += delta
            }

        case "response.done":
            await handleResponseDone(json: json, ws: ws)

        case "conversation.item.input_audio_transcription.completed":
            let transcript = (json["transcript"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !transcript.isEmpty { options.onSpokenAsk?(transcript) }

        case "error":
            let message = (json["error"] as? [String: Any])?["message"] as? String
            options.onError(message)
            close()

        default:
            break
        }
    }

    private func handleResponseDone(json: [String: Any], ws: any WebSocketTask) async {
        let output = (json["response"] as? [String: Any])
            .flatMap { $0["output"] as? [[String: Any]] } ?? []
        let functionCalls = output.filter { $0["type"] as? String == "function_call" }

        for item in functionCalls {
            guard
                let callId = item["call_id"] as? String,
                let name = item["name"] as? String,
                let argsStr = item["arguments"] as? String
            else { continue }
            let args = (try? JSONSerialization.jsonObject(with: Data(argsStr.utf8)) as? [String: Any]) ?? [:]
            let result: String
            if isArmed, let dispatch = options.dispatchToolCall {
                result = await dispatch(name, args, callId)
            } else {
                result = #"{"error":"not authorized"}"#
            }
            try? await ws.sendText(functionCallOutputJSON(callId: callId, output: result))
        }

        if !functionCalls.isEmpty {
            // Follow-up response requested; stay in .thinking until the model speaks.
            try? await ws.sendText(#"{"type":"response.create"}"#)
        } else if status == .thinking {
            // Audio-only response whose audio finished before response.done arrived,
            // or an unexpected silent response — transition to ready.
            status = .ready
            resetIdleTimer()
        }

        isArmed = false
        pendingCalls.removeAll()
    }

    private func resetIdleTimer() {
        idleTask?.cancel()
        let timeout = options.idleTimeoutSeconds
        idleTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.close()
        }
    }

    // MARK: - JSON helpers

    private func contextItemJSON(_ item: VoiceContextItem) -> String {
        let escaped = jsonEscape(item.text)
        return """
            {"type":"conversation.item.create","item":{"id":"\(item.itemId)","type":"message","role":"user","content":[{"type":"input_text","text":"\(escaped)"}]}}
            """
    }

    private func audioAppendJSON(_ chunk: [Int16]) -> String {
        let b64 = chunk.withUnsafeBytes { Data($0) }.base64EncodedString()
        return #"{"type":"input_audio_buffer.append","audio":"\#(b64)"}"#
    }

    private func functionCallOutputJSON(callId: String, output: String) -> String {
        let escaped = jsonEscape(output)
        return """
            {"type":"conversation.item.create","item":{"type":"function_call_output","call_id":"\(callId)","output":"\(escaped)"}}
            """
    }

    private func jsonEscape(_ s: String) -> String {
        s
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\t", with: "\\t")
    }
}

// MARK: - URLSession WebSocket implementation

private final class URLSessionWebSocketChannel: WebSocketTask, @unchecked Sendable {
    private let task: URLSessionWebSocketTask

    init(url: URL, bearerToken: String) {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        request.setValue("realtime=v1", forHTTPHeaderField: "OpenAI-Beta")
        task = URLSession.shared.webSocketTask(with: request)
    }

    func resume() { task.resume() }

    func sendText(_ text: String) async throws {
        try await task.send(.string(text))
    }

    func receiveText() async throws -> String {
        switch try await task.receive() {
        case .string(let s): return s
        case .data(let d): return String(data: d, encoding: .utf8) ?? ""
        @unknown default: throw URLError(.badServerResponse)
        }
    }

    func close() {
        task.cancel(with: .normalClosure, reason: nil)
    }
}
