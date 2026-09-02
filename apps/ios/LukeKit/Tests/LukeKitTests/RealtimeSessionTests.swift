import Foundation
import XCTest

@testable import LukeKit

// MARK: - Mock WebSocket

/// A scripted WebSocket channel. The test delivers server messages via
/// `deliver(_:)` and captures what the session sent via `outgoing`.
private final class MockWebSocketTask: WebSocketTask, @unchecked Sendable {
    private let stream: AsyncStream<String>
    let continuation: AsyncStream<String>.Continuation
    private(set) var outgoing: [String] = []
    private(set) var closeCount = 0
    private var iterator: AsyncStream<String>.AsyncIterator

    init() {
        var cont: AsyncStream<String>.Continuation!
        stream = AsyncStream { cont = $0 }
        continuation = cont
        iterator = stream.makeAsyncIterator()
    }

    func resume() {}

    func sendText(_ text: String) async throws { outgoing.append(text) }

    func receiveText() async throws -> String {
        guard let msg = await iterator.next() else { throw URLError(.cancelled) }
        return msg
    }

    func close() {
        closeCount += 1
        continuation.finish()
    }

    func deliver(_ message: String) { continuation.yield(message) }
}

// MARK: - Mock audio

private final class SilentCapturer: AudioCapturer, Sendable {
    func start() throws -> AsyncStream<[Int16]> { AsyncStream { $0.finish() } }
    func stop() {}
}

private final class NullPlayer: AudioPlayer, Sendable {
    func enqueue(_ samples: [Int16]) {}
    func drain(then completion: @MainActor @Sendable @escaping () -> Void) {
        Task { @MainActor in completion() }
    }
    func stop() {}
}

private final class RecordingPlayer: AudioPlayer, @unchecked Sendable {
    private(set) var batches: [[Int16]] = []
    private(set) var drainCount = 0
    private(set) var stopCount = 0

    func enqueue(_ samples: [Int16]) { batches.append(samples) }
    func drain(then completion: @MainActor @Sendable @escaping () -> Void) {
        drainCount += 1
        Task { @MainActor in completion() }
    }
    func stop() { stopCount += 1 }
}

// MARK: - Helpers

private let testContext = VoiceContextItem(
    itemId: "luke_ctx_sessions_0",
    text: "No sessions observed."
)

private let testConnection = VoiceConnection(
    ephemeralKey: "ek_test",
    wsURL: URL(string: "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime")!,
    expiresAt: Date().addingTimeInterval(60),
    model: "gpt-4o-realtime",
    sessionsContext: testContext
)

final class RealtimeWebSocketAuthenticationTests: XCTestCase {
    func testEphemeralKeyUsesClientSideWebSocketProtocols() {
        XCTAssertEqual(
            realtimeWebSocketProtocols(ephemeralKey: "ek_test"),
            ["realtime", "openai-insecure-api-key.ek_test"]
        )
    }
}

// MARK: - State machine tests

@MainActor
final class RealtimeSessionStateTests: XCTestCase {
    func testInitialStatusIsIdle() {
        let opts = makeOptions(ws: MockWebSocketTask())
        let session = RealtimeSession(options: opts)
        XCTAssertEqual(session.status, .idle)
    }

    func testConnectSetsConnectingThenTransitionsOnSessionCreated() async throws {
        let ws = MockWebSocketTask()
        var statuses: [RealtimeStatus] = []
        let opts = makeOptions(ws: ws, onStatus: { statuses.append($0) })
        let session = RealtimeSession(options: opts)

        // Start connect and deliver session.created before connect returns.
        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        // Give the receive loop a moment to process.
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertTrue(statuses.contains(.connecting))
        XCTAssertTrue(statuses.contains(.ready))
    }

    func testContextItemSentOnChannelOpen() async throws {
        let ws = MockWebSocketTask()
        let opts = makeOptions(ws: ws)
        let session = RealtimeSession(options: opts)

        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        try await Task.sleep(nanoseconds: 50_000_000)

        let sent = ws.outgoing.joined(separator: "\n")
        XCTAssertTrue(sent.contains("conversation.item.create"), "Should send context item on open")
        XCTAssertTrue(sent.contains(testContext.itemId))
    }

    func testBeginAndEndTurnSendsCommit() async throws {
        let ws = MockWebSocketTask()
        let opts = makeOptions(ws: ws)
        let session = RealtimeSession(options: opts)

        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        try await Task.sleep(nanoseconds: 50_000_000)

        session.beginTurn()
        XCTAssertEqual(session.status, .listening)
        session.endTurn()
        try await Task.sleep(nanoseconds: 50_000_000)

        let sent = ws.outgoing.joined(separator: "\n")
        XCTAssertTrue(sent.contains("input_audio_buffer.commit"), "Should commit on endTurn")
        XCTAssertTrue(sent.contains("response.create"), "Should request response on endTurn")
        XCTAssertEqual(session.status, .thinking)
    }

    func testServerErrorBeforeResponseStartsReturnsReadyWithoutClosingConnection() async throws {
        let ws = MockWebSocketTask()
        var fatalErrors: [String] = []
        var recoverableErrors: [String] = []
        let opts = makeOptions(
            ws: ws,
            onError: { if let message = $0 { fatalErrors.append(message) } },
            onRecoverableError: { recoverableErrors.append($0) }
        )
        let session = RealtimeSession(options: opts)

        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        try await Task.sleep(nanoseconds: 50_000_000)

        session.beginTurn()
        session.endTurn()
        ws.deliver(#"{"type":"error","error":{"message":"buffer too small"}}"#)
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(session.status, .ready)
        XCTAssertEqual(recoverableErrors, ["buffer too small"])
        XCTAssertTrue(fatalErrors.isEmpty)
        XCTAssertEqual(ws.closeCount, 0)
    }

    func testServerErrorAfterResponseStartsDoesNotEndActiveResponse() async throws {
        let ws = MockWebSocketTask()
        let opts = makeOptions(ws: ws)
        let session = RealtimeSession(options: opts)

        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        try await Task.sleep(nanoseconds: 50_000_000)

        session.beginTurn()
        session.endTurn()
        ws.deliver(#"{"type":"response.created"}"#)
        ws.deliver(#"{"type":"error","error":{"message":"recoverable aside"}}"#)
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(session.status, .thinking)
        XCTAssertEqual(ws.closeCount, 0)
    }

    func testGAOutputAudioEventsPlayAndDrainBeforeReturningReady() async throws {
        let ws = MockWebSocketTask()
        let player = RecordingPlayer()
        let opts = makeOptions(ws: ws, player: player)
        let session = RealtimeSession(options: opts)

        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        try await Task.sleep(nanoseconds: 50_000_000)

        session.beginTurn()
        session.endTurn()
        ws.deliver(#"{"type":"response.created"}"#)
        ws.deliver(#"{"type":"response.output_audio.delta","delta":"AQD+/w=="}"#)
        ws.deliver(#"{"type":"response.output_audio.done"}"#)
        ws.deliver(#"{"type":"response.done","response":{"output":[]}}"#)
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(player.batches, [[1, -2]])
        XCTAssertEqual(player.drainCount, 1)
        XCTAssertEqual(player.stopCount, 1)
        XCTAssertEqual(session.status, .ready)
    }

    func testGAOutputTranscriptEventsStreamAndFinishCaption() async throws {
        let ws = MockWebSocketTask()
        var captions: [String?] = []
        let opts = makeOptions(ws: ws, onCaption: { captions.append($0) })
        let session = RealtimeSession(options: opts)

        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        try await Task.sleep(nanoseconds: 50_000_000)

        ws.deliver(#"{"type":"response.output_audio_transcript.delta","delta":"Hello"}"#)
        ws.deliver(#"{"type":"response.output_audio_transcript.delta","delta":" there"}"#)
        ws.deliver(#"{"type":"response.output_audio_transcript.done"}"#)
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(captions.count, 3)
        XCTAssertEqual(captions[0], "Hello")
        XCTAssertEqual(captions[1], "Hello there")
        XCTAssertNil(captions[2])
    }

    func testCompletedInputTranscriptReturnsDeveloperWords() async throws {
        let ws = MockWebSocketTask()
        var spokenAsks: [String] = []
        let opts = makeOptions(ws: ws, onSpokenAsk: { spokenAsks.append($0) })
        let session = RealtimeSession(options: opts)

        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        try await Task.sleep(nanoseconds: 50_000_000)

        ws.deliver(#"{"type":"conversation.item.input_audio_transcription.completed","transcript":"  Hello Luke  "}"#)
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(spokenAsks, ["Hello Luke"])
    }

    func testPressAudioBufferedDuringConnecting() async throws {
        let ws = MockWebSocketTask()
        let capturer = SequenceCapturer(chunks: [[1, 2, 3]])
        let opts = makeOptions(ws: ws, capturer: capturer)
        let session = RealtimeSession(options: opts)

        // Call beginTurn while connecting (before session.created)
        let connectTask = Task { await session.connect() }
        // Tiny delay so connect() has started and status is .connecting
        try await Task.sleep(nanoseconds: 10_000_000)
        session.beginTurn()
        // Now deliver session.created
        ws.deliver(#"{"type":"session.created"}"#)
        await connectTask.value
        try await Task.sleep(nanoseconds: 50_000_000)

        let sent = ws.outgoing.joined(separator: "\n")
        // The press-buffered audio should have been flushed as input_audio_buffer.append
        XCTAssertTrue(sent.contains("input_audio_buffer.append"), "Should flush buffered audio on open")
    }

    func testUnarmedResponseDoneRefusesCalls() async throws {
        let ws = MockWebSocketTask()
        var dispatchedNames: [String] = []
        let opts = makeOptions(ws: ws, dispatchToolCall: { name, _, _ in
            dispatchedNames.append(name)
            return #"{"result":"sent"}"#
        })
        let session = RealtimeSession(options: opts)

        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        try await Task.sleep(nanoseconds: 50_000_000)

        // Deliver response.done with a function call WITHOUT the session being armed
        ws.deliver("""
            {"type":"response.done","response":{"output":[{"type":"function_call","call_id":"c1","name":"send_session_message","arguments":"{}"}]}}
            """)
        try await Task.sleep(nanoseconds: 50_000_000)

        // dispatchToolCall must NOT have been called — the session was not armed
        XCTAssertTrue(dispatchedNames.isEmpty, "Unarmed calls must not reach dispatchToolCall")

        let sent = ws.outgoing.joined(separator: "\n")
        // A rejection output should have been sent
        XCTAssertTrue(sent.contains("function_call_output"), "Should send rejection output")
        XCTAssertTrue(sent.contains("not authorized"))
    }

    func testArmedResponseDoneDispatchesCalls() async throws {
        let ws = MockWebSocketTask()
        var dispatchedNames: [String] = []
        let opts = makeOptions(ws: ws, dispatchToolCall: { name, _, _ in
            dispatchedNames.append(name)
            return #"{"result":"sent"}"#
        })
        let session = RealtimeSession(options: opts)

        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        try await Task.sleep(nanoseconds: 50_000_000)

        // Arm the session
        session.beginTurn()
        session.endTurn()
        try await Task.sleep(nanoseconds: 20_000_000)

        // Deliver response.done with a function call
        ws.deliver("""
            {"type":"response.done","response":{"output":[{"type":"function_call","call_id":"c1","name":"send_session_message","arguments":"{}"}]}}
            """)
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(dispatchedNames, ["send_session_message"])
        let sent = ws.outgoing.joined(separator: "\n")
        // The dispatch result is JSON-escaped inside the function_call_output event,
        // so "result":"sent" appears as \"result\":\"sent\" in the wire bytes.
        // Assert on the structural properties instead: the right message type was
        // sent and addressed to the right call.
        XCTAssertTrue(sent.contains("function_call_output"), "Should forward dispatch result to WebSocket")
        XCTAssertTrue(sent.contains(#""call_id":"c1""#), "Should address the correct call_id")
    }

    func testCloseResetsToIdle() async throws {
        let ws = MockWebSocketTask()
        let opts = makeOptions(ws: ws)
        let session = RealtimeSession(options: opts)

        Task { ws.deliver(#"{"type":"session.created"}"#) }
        await session.connect()
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(session.status, .ready)
        session.close()
        XCTAssertEqual(session.status, .idle)
    }

    // MARK: - Helpers

    private func makeOptions(
        ws: MockWebSocketTask,
        capturer: any AudioCapturer = SilentCapturer(),
        player: any AudioPlayer = NullPlayer(),
        onStatus: @MainActor @escaping (RealtimeStatus) -> Void = { _ in },
        onCaption: @MainActor @escaping (String?) -> Void = { _ in },
        onSpokenAsk: (@MainActor (String) -> Void)? = nil,
        onError: @MainActor @escaping (String?) -> Void = { _ in },
        onRecoverableError: (@MainActor (String) -> Void)? = nil,
        dispatchToolCall: (@Sendable @MainActor (_ name: String, _ arguments: [String: Any], _ callId: String) async -> String)? = nil
    ) -> RealtimeSessionOptions {
        RealtimeSessionOptions(
            requestConnection: { testConnection },
            onStatus: onStatus,
            onCaption: onCaption,
            onSpokenAsk: onSpokenAsk,
            onError: onError,
            onRecoverableError: onRecoverableError,
            dispatchToolCall: dispatchToolCall,
            makeWebSocket: { _, _ in ws },
            makeAudioCapturer: { capturer },
            makeAudioPlayer: { player }
        )
    }
}

// MARK: - A capturer that emits one batch of pre-set chunks then stops

private final class SequenceCapturer: AudioCapturer, @unchecked Sendable {
    private let chunks: [[Int16]]
    init(chunks: [[Int16]]) { self.chunks = chunks }
    func start() throws -> AsyncStream<[Int16]> {
        let c = chunks
        return AsyncStream { continuation in
            for chunk in c { continuation.yield(chunk) }
            continuation.finish()
        }
    }
    func stop() {}
}
