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

    func close() { continuation.finish() }

    func deliver(_ message: String) { continuation.yield(message) }
}

// MARK: - Mock audio

private final class SilentCapturer: AudioCapturer, Sendable {
    func start() throws -> AsyncStream<[Int16]> { AsyncStream { $0.finish() } }
    func stop() {}
}

private final class NullPlayer: AudioPlayer, Sendable {
    func enqueue(_ samples: [Int16]) {}
    func stop() {}
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
        onStatus: @MainActor @escaping (RealtimeStatus) -> Void = { _ in },
        dispatchToolCall: (@Sendable @MainActor (_ name: String, _ arguments: [String: Any], _ callId: String) async -> String)? = nil
    ) -> RealtimeSessionOptions {
        RealtimeSessionOptions(
            requestConnection: { testConnection },
            onStatus: onStatus,
            onCaption: { _ in },
            onError: { _ in },
            dispatchToolCall: dispatchToolCall,
            makeWebSocket: { _, _ in ws },
            makeAudioCapturer: { capturer },
            makeAudioPlayer: { NullPlayer() }
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
