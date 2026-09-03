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
    /// Lets already-queued buffers finish playing, then calls `completion` on
    /// the main actor. The player must not accept new buffers after this call.
    func drain(then completion: @MainActor @Sendable @escaping () -> Void)
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
    public var onStatus: @MainActor @Sendable (RealtimeStatus) -> Void
    /// Called with the running caption text while the model speaks, nil when done. Always delivered on the main actor.
    public var onCaption: @MainActor @Sendable (String?) -> Void
    /// Called with the developer's transcribed words when a turn ends. Always delivered on the main actor.
    public var onSpokenAsk: (@MainActor @Sendable (String) -> Void)?
    /// Called with an error description when the session closes unexpectedly. Always delivered on the main actor.
    public var onError: @MainActor @Sendable (String?) -> Void
    /// Called when the server rejects one event but keeps the session open.
    /// The current turn may end, but the developer can immediately try again.
    public var onRecoverableError: (@MainActor @Sendable (String) -> Void)?

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

    /// Monotonic clock used to measure how much response audio reached the
    /// speaker before an interruption. Injectable for deterministic tests.
    public var now: @Sendable () -> TimeInterval

    public init(
        requestConnection: @Sendable @escaping () async throws -> VoiceConnection,
        onStatus: @MainActor @Sendable @escaping (RealtimeStatus) -> Void,
        onCaption: @MainActor @Sendable @escaping (String?) -> Void,
        onSpokenAsk: (@MainActor @Sendable (String) -> Void)? = nil,
        onError: @MainActor @Sendable @escaping (String?) -> Void,
        onRecoverableError: (@MainActor @Sendable (String) -> Void)? = nil,
        dispatchToolCall: (
            @Sendable @MainActor (_ name: String, _ arguments: [String: Any], _ callId: String) async -> String
        )? = nil,
        makeWebSocket: (@Sendable (URL, String) -> any WebSocketTask)? = nil,
        makeAudioCapturer: @Sendable @escaping () -> any AudioCapturer,
        makeAudioPlayer: @Sendable @escaping () -> any AudioPlayer,
        idleTimeoutSeconds: Double = 180,
        now: @Sendable @escaping () -> TimeInterval = {
            ProcessInfo.processInfo.systemUptime
        }
    ) {
        self.requestConnection = requestConnection
        self.onStatus = onStatus
        self.onCaption = onCaption
        self.onSpokenAsk = onSpokenAsk
        self.onError = onError
        self.onRecoverableError = onRecoverableError
        self.dispatchToolCall = dispatchToolCall
        self.makeWebSocket = makeWebSocket
        self.makeAudioCapturer = makeAudioCapturer
        self.makeAudioPlayer = makeAudioPlayer
        self.idleTimeoutSeconds = idleTimeoutSeconds
        self.now = now
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
    private var drainingPlayers: [UUID: any AudioPlayer] = [:]
    // A drained player stays alive until every response in the chain has
    // finished. Stopping it sooner may deactivate the shared AVAudioSession
    // while a tool follow-up player is already speaking.
    private var drainedPlayers: [any AudioPlayer] = []
    private var pressBuffer = PressAudioBuffer()

    // True during a turn the developer explicitly opened; cleared after
    // response.done so only that one response may dispatch tool calls.
    private var isArmed = false
    // Set when a tool follow-up response.create has been sent and cleared when
    // that follow-up's response.done arrives, so audio completion does not
    // return the session to .ready while the follow-up is in flight.
    private var followUpPending = false
    // True once the server confirms the response requested for the current
    // turn. Before that confirmation, an error replaces response.done and must
    // return the session to ready rather than strand it in thinking.
    private var responseStarted = false
    // Counts how many player drains are in progress. Each output-audio ending
    // creates one drain; the session may not return to .ready until the last
    // drain completes (pendingDrains == 0) and no follow-up is in flight.
    private var pendingDrains = 0
    // Set when the developer releases while still connecting, so we commit
    // and request a response the moment the channel opens.
    private var pendingCommit = false

    private var receiveTask: Task<Void, Never>?
    private var captureTask: Task<Void, Never>?
    private var idleTask: Task<Void, Never>?

    private var pendingCalls: [String: (name: String, args: String)] = [:]
    private var captionBuffer = ""
    private var activeResponseId: String?
    private var activeResponseItemId: String?
    private var responseAudioStartedAt: TimeInterval?
    private var responseAudioSampleCount = 0
    private var interruptedResponseIds: Set<String> = []
    private var pendingInterruptionEventIds: Set<String> = []
    private var interruptionSequence = 0

    public init(options: RealtimeSessionOptions) {
        self.options = options
    }

    // MARK: - Public API

    public func connect() async {
        guard status == .idle else { return }
        status = .connecting
        do {
            let connection = try await options.requestConnection()
            // close() may have been called while the mint was in flight.
            guard status == .connecting else { return }
            let ws: any WebSocketTask
            if let factory = options.makeWebSocket {
                ws = factory(connection.wsURL, connection.ephemeralKey)
            } else {
                ws = URLSessionWebSocketChannel(
                    url: connection.wsURL, ephemeralKey: connection.ephemeralKey
                )
            }
            channel = ws
            ws.resume()
            receiveTask = Task { [weak self] in
                await self?.runReceiveLoop(ws: ws, context: connection.sessionsContext)
            }
        } catch {
            // onError must run before status = .idle: onError nils reconnectCallback,
            // and onStatus(.idle) reads it — reversing the order creates an infinite
            // reconnect loop that swallows the error message.
            options.onError(error.localizedDescription)
            status = .idle
        }
    }

    /// Called when the developer presses and holds the talk button.
    public func beginTurn() {
        guard status == .connecting || status == .ready || status == .speaking else { return }
        if status == .speaking { interruptResponse() }
        if status == .connecting, pendingCommit {
            // A new press supersedes the released turn that was waiting for
            // the socket. Its buffered audio must not leak into the new turn.
            pendingCommit = false
            _ = pressBuffer.drain()
        }
        isArmed = true
        // Idle timer only runs between turns; cancel it rather than restart.
        idleTask?.cancel(); idleTask = nil
        startCapturing()
        if status != .connecting { status = .listening }
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
        for drainingPlayer in drainingPlayers.values { drainingPlayer.stop() }
        drainingPlayers.removeAll()
        for drainedPlayer in drainedPlayers { drainedPlayer.stop() }
        drainedPlayers.removeAll()
        channel?.close(); channel = nil
        isArmed = false
        followUpPending = false
        responseStarted = false
        pendingDrains = 0
        pendingCommit = false
        pendingCalls.removeAll()
        captionBuffer = ""
        clearActiveResponse()
        interruptedResponseIds.removeAll()
        pendingInterruptionEventIds.removeAll()
        status = .idle
        options.onCaption(nil)
    }

    // MARK: - Audio

    private func startCapturing() {
        captureTask?.cancel()
        let c = options.makeAudioCapturer()
        capturer = c
        captureTask = Task { [weak self] in
            do {
                let stream = try c.start()
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
            } catch {
                guard let self, !Task.isCancelled else { return }
                self.options.onError(error.localizedDescription)
                self.close()
            }
        }
    }

    private func stopCapturing() {
        captureTask?.cancel(); captureTask = nil
        capturer?.stop(); capturer = nil
    }

    private func commitAndRequestResponse() async {
        guard let ws = channel else { return }
        responseStarted = false
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

        case "response.created":
            responseStarted = true
            activeResponseId = (json["response"] as? [String: Any])?["id"] as? String
            activeResponseItemId = nil
            responseAudioStartedAt = nil
            responseAudioSampleCount = 0

        case "response.output_audio.delta", "response.audio.delta":
            guard !isStaleResponseEvent(json) else { return }
            responseStarted = true
            activeResponseId = activeResponseId ?? json["response_id"] as? String
            activeResponseItemId = activeResponseItemId ?? json["item_id"] as? String
            if player == nil { player = options.makeAudioPlayer() }
            if status != .speaking { status = .speaking }
            if let b64 = json["delta"] as? String, let data = Data(base64Encoded: b64) {
                let samples = data.withUnsafeBytes { ptr in Array(ptr.bindMemory(to: Int16.self)) }
                if responseAudioStartedAt == nil { responseAudioStartedAt = options.now() }
                responseAudioSampleCount += samples.count
                player?.enqueue(samples)
            }

        case "response.output_audio.done", "output_audio_buffer.stopped":
            guard !isStaleResponseEvent(json) else { return }
            // WebSocket sessions finish audio with response.output_audio.done;
            // output_audio_buffer.stopped is retained for older/alternate
            // transports. Drain locally queued PCM before returning to ready.
            finishOutputAudio()

        case "response.output_audio_transcript.delta", "response.audio_transcript.delta":
            guard !isStaleResponseEvent(json) else { return }
            if let delta = json["delta"] as? String {
                captionBuffer += delta
                options.onCaption(captionBuffer)
            }

        case "response.output_audio_transcript.done", "response.audio_transcript.done":
            guard !isStaleResponseEvent(json) else { return }
            // The completed words now live in the conversation history. End
            // this streaming segment so a tool follow-up gets its own bubble.
            captionBuffer = ""
            options.onCaption(nil)

        case "response.output_item.added":
            guard !isStaleResponseEvent(json) else { return }
            if let item = json["item"] as? [String: Any] {
                if item["type"] as? String == "message",
                   item["role"] as? String == "assistant"
                {
                    activeResponseItemId = item["id"] as? String
                } else if item["type"] as? String == "function_call",
                          let callId = item["call_id"] as? String,
                          let name = item["name"] as? String
                {
                    pendingCalls[callId] = (name: name, args: "")
                }
            }

        case "response.function_call_arguments.delta":
            guard !isStaleResponseEvent(json) else { return }
            if let callId = json["call_id"] as? String, let delta = json["delta"] as? String {
                pendingCalls[callId]?.args += delta
            }

        case "response.done":
            guard !isStaleResponseEvent(json) else { return }
            await handleResponseDone(json: json, ws: ws)

        case "conversation.item.input_audio_transcription.completed":
            let transcript = (json["transcript"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !transcript.isEmpty { options.onSpokenAsk?(transcript) }

        case "error":
            let error = json["error"] as? [String: Any]
            if let eventId = error?["event_id"] as? String,
               pendingInterruptionEventIds.remove(eventId) != nil
            {
                return
            }
            let message = error?["message"] as? String
                ?? "Realtime request failed."
            options.onRecoverableError?(message)
            // Realtime server errors normally leave the WebSocket open. An
            // empty push-to-talk commit is answered with an error instead of
            // response.done, so finish only that unstarted turn and keep the
            // conversation available for the next press.
            if status == .thinking, !responseStarted {
                isArmed = false
                followUpPending = false
                pendingCalls.removeAll()
                clearActiveResponse()
                status = .ready
                resetIdleTimer()
            }

        default:
            break
        }
    }

    private func handleResponseDone(json: [String: Any], ws: any WebSocketTask) async {
        let responseInterruptionSequence = interruptionSequence
        let output = (json["response"] as? [String: Any])
            .flatMap { $0["output"] as? [[String: Any]] } ?? []
        let functionCalls = output.filter { $0["type"] as? String == "function_call" }
        responseStarted = false

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
            // A new developer turn may have interrupted while the hosted act
            // was in flight. The act has already happened, but its old model
            // response must not resume over the new microphone turn.
            guard interruptionSequence == responseInterruptionSequence else { return }
            try? await ws.sendText(functionCallOutputJSON(callId: callId, output: result))
            guard interruptionSequence == responseInterruptionSequence else { return }
        }

        if !functionCalls.isEmpty {
            // Follow-up response requested; stay in .thinking until the model speaks.
            // Mark the follow-up in flight so the current audio ending does not
            // return the session to .ready prematurely.
            followUpPending = true
            responseStarted = false
            try? await ws.sendText(#"{"type":"response.create"}"#)
        } else {
            // This is the follow-up response itself (or an audio-only primary response).
            followUpPending = false
            if status == .thinking {
                // Audio-only response whose audio finished before response.done
                // arrived, or a silent response — transition to ready now.
                status = .ready
                clearActiveResponse()
                resetIdleTimer()
                stopDrainedPlayers()
            } else if status == .speaking, pendingDrains == 0, player == nil {
                // Silent follow-up: the primary drain already completed but could not
                // transition because followUpPending was true. Transition now.
                status = .ready
                clearActiveResponse()
                resetIdleTimer()
                stopDrainedPlayers()
            }
        }

        isArmed = false
        pendingCalls.removeAll()
    }

    private func finishOutputAudio() {
        guard let p = player else {
            options.onCaption(nil)
            return
        }
        player = nil
        pendingDrains += 1
        let drainId = UUID()
        drainingPlayers[drainId] = p
        p.drain { [weak self] in
            guard let self,
                  self.drainingPlayers.removeValue(forKey: drainId) != nil
            else { return }
            self.drainedPlayers.append(p)
            self.pendingDrains -= 1
            self.options.onCaption(nil)
            if self.status == .speaking,
               !self.followUpPending,
               !self.responseStarted,
               self.pendingDrains == 0
            {
                self.status = .ready
                self.clearActiveResponse()
                self.resetIdleTimer()
                self.stopDrainedPlayers()
            }
        }
    }

    private func stopDrainedPlayers() {
        for drainedPlayer in drainedPlayers { drainedPlayer.stop() }
        drainedPlayers.removeAll()
    }

    /// The developer's turn wins immediately over a response that is still
    /// playing. WebSocket sessions own their playback buffer locally, so the
    /// player is stopped here; the server is separately told to stop making
    /// more audio and to forget the generated tail nobody heard.
    private func interruptResponse() {
        let responseId = activeResponseId
        let responseItemId = activeResponseItemId
        let audioEndMs = heardAudioMilliseconds()
        let shouldCancel = responseStarted

        player?.stop()
        player = nil
        for drainingPlayer in drainingPlayers.values { drainingPlayer.stop() }
        drainingPlayers.removeAll()
        for drainedPlayer in drainedPlayers { drainedPlayer.stop() }
        drainedPlayers.removeAll()
        pendingDrains = 0
        captionBuffer = ""
        options.onCaption(nil)

        if let responseId {
            interruptedResponseIds.insert(responseId)
            while interruptedResponseIds.count > 8 {
                interruptedResponseIds.remove(interruptedResponseIds.first!)
            }
        }

        interruptionSequence += 1
        let sequence = interruptionSequence
        var events: [String] = []
        if shouldCancel {
            let eventId = "ios_response_cancel_\(sequence)"
            pendingInterruptionEventIds.insert(eventId)
            events.append(responseCancelJSON(eventId: eventId))
        }
        if let responseItemId, audioEndMs > 0 {
            let eventId = "ios_item_truncate_\(sequence)"
            pendingInterruptionEventIds.insert(eventId)
            events.append(
                responseTruncateJSON(
                    eventId: eventId,
                    itemId: responseItemId,
                    audioEndMs: audioEndMs
                )
            )
        }
        while pendingInterruptionEventIds.count > 16 {
            pendingInterruptionEventIds.remove(pendingInterruptionEventIds.first!)
        }

        if let channel, !events.isEmpty {
            Task {
                for event in events { try? await channel.sendText(event) }
            }
        }

        responseStarted = false
        followUpPending = false
        pendingCalls.removeAll()
        clearActiveResponse()
    }

    private func heardAudioMilliseconds() -> Int {
        guard let startedAt = responseAudioStartedAt,
              responseAudioSampleCount > 0
        else { return 0 }
        let elapsed = max(0, options.now() - startedAt)
        let available = Double(responseAudioSampleCount) / Double(PressAudioBuffer.sampleRate)
        return Int((min(elapsed, available) * 1_000).rounded(.down))
    }

    private func isFromInterruptedResponse(_ json: [String: Any]) -> Bool {
        let responseId = json["response_id"] as? String
            ?? (json["response"] as? [String: Any])?["id"] as? String
        guard let responseId else { return false }
        return interruptedResponseIds.contains(responseId)
    }

    private func isStaleResponseEvent(_ json: [String: Any]) -> Bool {
        if isFromInterruptedResponse(json) { return true }
        // No response belongs to an open developer microphone. This also
        // rejects legacy packets that omitted response_id after an interrupt.
        return status == .listening && activeResponseId == nil
    }

    private func clearActiveResponse() {
        activeResponseId = nil
        activeResponseItemId = nil
        responseAudioStartedAt = nil
        responseAudioSampleCount = 0
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

    private func responseCancelJSON(eventId: String) -> String {
        #"{"type":"response.cancel","event_id":"\#(jsonEscape(eventId))"}"#
    }

    private func responseTruncateJSON(
        eventId: String,
        itemId: String,
        audioEndMs: Int
    ) -> String {
        """
        {"type":"conversation.item.truncate","event_id":"\(jsonEscape(eventId))","item_id":"\(jsonEscape(itemId))","content_index":0,"audio_end_ms":\(audioEndMs)}
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

    init(url: URL, ephemeralKey: String) {
        task = URLSession.shared.webSocketTask(
            with: url,
            protocols: realtimeWebSocketProtocols(ephemeralKey: ephemeralKey)
        )
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

func realtimeWebSocketProtocols(ephemeralKey: String) -> [String] {
    ["realtime", "openai-insecure-api-key.\(ephemeralKey)"]
}
