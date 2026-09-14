import Foundation
import LukeKit
import Network

/// The voice socket on the watch, opened through Network framework: the
/// `VoiceSocket` `HostedVoiceSessionClient` speaks the audio route over, with
/// the bearer and the watch's own device row on its handshake.
///
/// watchOS grants low-level networking to an audio streaming app by process,
/// and URLSession on watchOS does its work in a system process of its own,
/// so a `URLSessionWebSocketTask` never carries the grant this app's active
/// audio session earned: the flow is denied by policy and reported as
/// offline. Network framework opens the socket from this process, where the
/// grant lives (TN3135; Apple DTS on developer forum thread 773362). What the
/// framework does not hand back is the status of a refused upgrade: a 401, a
/// 403, or a 503 ends the connection as a failure the same as a dropped path,
/// so a refusal the service states in its first frame is read as the phone
/// reads it, and one it states in the status alone reads as the service not
/// reached.
final class WatchWebSocketChannel: VoiceSocket, @unchecked Sendable {
    /// The bound on one frame the service sends. Luke's audio arrives as
    /// base64 chunks of a fraction of a second each, and every other frame is
    /// a small document; this is far above either.
    static let maximumMessageSize = 4 << 20

    private let connection: NWConnection
    private let queue = DispatchQueue(label: "dev.tryluke.watchos.voice-socket")
    private let lock = NSLock()
    private var isReady = false
    private var opening: VoiceSocketOpening?
    private var openWaiters: [CheckedContinuation<VoiceSocketOpening, Never>] = []

    init(url: URL, headers: VoiceHandshakeHeaders) {
        let webSocket = NWProtocolWebSocket.Options()
        webSocket.autoReplyPing = true
        webSocket.maximumMessageSize = Self.maximumMessageSize
        // Exactly the declared fields, as the phone's socket sends them: the bearer and the device row, and no `Origin`.
        webSocket.setAdditionalHeaders(headers.fields.map { (name: $0.key, value: $0.value) })
        let parameters = NWParameters.tls
        parameters.defaultProtocolStack.applicationProtocols.insert(webSocket, at: 0)
        connection = NWConnection(to: .url(url), using: parameters)
    }

    /// Starts the connection and settles with the handshake's outcome. A wait
    /// the client's deadline cancels ends the attempt, so no socket is left
    /// connecting behind a deadline that passed.
    func open() async -> VoiceSocketOpening {
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                lock.withLock { isReady = true }
                settle(.opened)
            case .failed, .cancelled:
                settle(.failed)
            case .waiting:
                // No path carries the flow yet, or for the moment: watchOS
                // brings the path up on demand, so a handshake waits here
                // before it opens, and a standing socket waits here through a
                // brief Bluetooth or Wi-Fi gap. Neither is ended: a socket
                // watchOS refused the grant to would wait forever, and the
                // client's handshake deadline is what ends that one, through
                // the cancellation of `open()`; a standing socket that never
                // recovers fails, and its next receive reads the close.
                break
            default:
                break
            }
        }
        connection.start(queue: queue)
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                lock.withLock {
                    if let opening {
                        continuation.resume(returning: opening)
                    } else {
                        openWaiters.append(continuation)
                    }
                }
            }
        } onCancel: {
            close()
        }
    }

    func send(_ text: String) async throws {
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            connection.send(
                content: Data(text.utf8),
                contentContext: context,
                isComplete: true,
                completion: .contentProcessed { error in
                    if let error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume()
                    }
                }
            )
        }
    }

    /// The next frame, or the close that ended the socket. A wait the reader's
    /// cancellation ends closes the socket, since the reader is cancelled only
    /// by a hang-up that is about to close it anyway.
    func receive() async -> VoiceSocketArrival {
        await withTaskCancellationHandler {
            while true {
                guard let message = await receiveMessage() else { return .closed(code: nil) }
                let (data, metadata) = message
                switch metadata?.opcode {
                case .text, .binary:
                    return .frame(String(decoding: data, as: UTF8.self))
                case .close:
                    return .closed(code: Self.closeCode(metadata))
                default:
                    // Pings are answered by the connection itself; a pong is nothing to hand up.
                    continue
                }
            }
        } onCancel: {
            close()
        }
    }

    /// Ends the connection; safe to call more than once. A close frame is
    /// owed only to a peer that was reached: a socket still connecting or
    /// refused has nothing to send it to, and a send queued on it would never
    /// complete, so it is cancelled outright.
    func close() {
        settle(.failed)
        queue.async { [self] in
            guard lock.withLock({ isReady }) else {
                connection.cancel()
                return
            }
            let metadata = NWProtocolWebSocket.Metadata(opcode: .close)
            metadata.closeCode = .protocolCode(.normalClosure)
            let context = NWConnection.ContentContext(identifier: "close", metadata: [metadata])
            connection.send(
                content: nil,
                contentContext: context,
                isComplete: true,
                completion: .contentProcessed { [connection] _ in connection.cancel() }
            )
        }
    }

    // MARK: - Private

    /// The handshake's outcome, told once to every waiter and kept for any that asks later.
    private func settle(_ outcome: VoiceSocketOpening) {
        let waiters: [CheckedContinuation<VoiceSocketOpening, Never>] = lock.withLock {
            guard opening == nil else { return [] }
            opening = outcome
            let waiting = openWaiters
            openWaiters = []
            return waiting
        }
        for waiter in waiters { waiter.resume(returning: outcome) }
    }

    /// One message off the connection, or nothing once the connection is over.
    private func receiveMessage() async -> (Data, NWProtocolWebSocket.Metadata?)? {
        await withCheckedContinuation { continuation in
            connection.receiveMessage { data, context, _, error in
                guard error == nil else {
                    continuation.resume(returning: nil)
                    return
                }
                let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition)
                    as? NWProtocolWebSocket.Metadata
                // A connection that ended cleanly answers no content and no error, once.
                guard data != nil || metadata != nil else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: (data ?? Data(), metadata))
            }
        }
    }

    /// The close frame's code as RFC 6455 numbers it, where the peer sent one.
    private static func closeCode(_ metadata: NWProtocolWebSocket.Metadata?) -> Int? {
        guard let closeCode = metadata?.closeCode else { return nil }
        switch closeCode {
        case .protocolCode(let defined):
            switch defined {
            case .normalClosure: return 1000
            case .goingAway: return 1001
            case .protocolError: return 1002
            case .unsupportedData: return 1003
            case .noStatusReceived: return 1005
            case .abnormalClosure: return 1006
            @unknown default: return nil
            }
        case .applicationCode(let code), .privateCode(let code):
            return Int(code)
        @unknown default:
            return nil
        }
    }
}

/// Makes one `WatchWebSocketChannel` per connection, for `HostedVoiceSessionClient`'s socket seam.
struct WatchWebSocketOpener: VoiceSocketOpener {
    func socket(url: URL, headers: VoiceHandshakeHeaders) -> any VoiceSocket {
        WatchWebSocketChannel(url: url, headers: headers)
    }
}
