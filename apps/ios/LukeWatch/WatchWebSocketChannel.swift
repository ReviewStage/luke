import Foundation
import LukeKit
import Network

/// The Realtime socket on the watch, opened through Network framework.
///
/// watchOS grants low-level networking to an audio streaming app by process,
/// and URLSession on watchOS does its work in a system process of its own,
/// so a `URLSessionWebSocketTask` never carries the grant this app's active
/// audio session earned: the flow is denied by policy and reported as
/// offline. Network framework opens the socket from this process, where the
/// grant lives (TN3135; Apple DTS on developer forum thread 773362).
final class WatchWebSocketChannel: WebSocketTask, @unchecked Sendable {
    private let connection: NWConnection
    private let queue = DispatchQueue(label: "dev.tryluke.watchos.realtime-socket")
    private var isReady = false
    private var failure: (any Error)?
    private var readyWaiters: [CheckedContinuation<Void, any Error>] = []

    init(url: URL, ephemeralKey: String) {
        let webSocket = NWProtocolWebSocket.Options()
        webSocket.autoReplyPing = true
        webSocket.setSubprotocols(realtimeWebSocketProtocols(ephemeralKey: ephemeralKey))
        let parameters = NWParameters.tls
        parameters.defaultProtocolStack.applicationProtocols.insert(webSocket, at: 0)
        connection = NWConnection(to: .url(url), using: parameters)
    }

    func resume() {
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.settle(nil)
            case .failed(let error):
                self.settle(WatchNetworkFailure(error))
            case .waiting(let error):
                // Waiting means no path will carry this flow now. The mint
                // just crossed on HTTP, so a path exists; a socket left
                // waiting here is one watchOS refused, and it would wait
                // forever rather than fail on its own.
                self.settle(WatchNetworkFailure(error))
            case .cancelled:
                self.settle(CancellationError())
            default:
                break
            }
        }
        connection.start(queue: queue)
    }

    func sendText(_ text: String) async throws {
        try await ready()
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            connection.send(
                content: Data(text.utf8),
                contentContext: context,
                isComplete: true,
                completion: .contentProcessed { error in
                    if let error {
                        continuation.resume(throwing: WatchNetworkFailure(error))
                    } else {
                        continuation.resume()
                    }
                }
            )
        }
    }

    func receiveText() async throws -> String {
        try await ready()
        while true {
            let (data, metadata) = try await receiveMessage()
            switch metadata?.opcode {
            case .text, .binary:
                return String(decoding: data, as: UTF8.self)
            case .close:
                throw WatchNetworkFailure(NWError.posix(.ECONNRESET))
            default:
                continue
            }
        }
    }

    func close() {
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

    // MARK: - Private

    private func settle(_ error: (any Error)?) {
        if let error {
            failure = error
        } else {
            isReady = true
        }
        let waiters = readyWaiters
        readyWaiters.removeAll()
        for waiter in waiters {
            if let error {
                waiter.resume(throwing: error)
            } else {
                waiter.resume()
            }
        }
    }

    private func ready() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            queue.async {
                if let failure = self.failure {
                    continuation.resume(throwing: failure)
                } else if self.isReady {
                    continuation.resume()
                } else {
                    self.readyWaiters.append(continuation)
                }
            }
        }
    }

    private func receiveMessage() async throws -> (Data, NWProtocolWebSocket.Metadata?) {
        try await withCheckedThrowingContinuation { continuation in
            connection.receiveMessage { data, context, _, error in
                if let error {
                    continuation.resume(throwing: WatchNetworkFailure(error))
                    return
                }
                let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition)
                    as? NWProtocolWebSocket.Metadata
                continuation.resume(returning: (data ?? Data(), metadata))
            }
        }
    }
}
