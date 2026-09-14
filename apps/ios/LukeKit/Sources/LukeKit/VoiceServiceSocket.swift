import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The socket seam the hosted voice session client opens its connections
/// through, the phone's `OpenSocket` (`packages/voice/src/live-socket.ts`).
/// Injected so the client and its tests never reach the network, and so the
/// tests run on Linux, where nothing answers a WebSocket.

/// The headers a handshake carries, and nothing else: the bearer, and on a
/// creation the device row the session is opened for. Named as a type rather
/// than a free dictionary so the set the socket sends is the set declared
/// here, which is what keeps an `Origin` out of it (the route answers 403 to
/// one, `apps/web/server/voice/service.ts`).
public struct VoiceHandshakeHeaders: Equatable, Sendable {
    public let bearer: String
    public let deviceId: String?

    public init(bearer: String, deviceId: String?) {
        self.bearer = bearer
        self.deviceId = deviceId
    }

    static let authorizationField = "Authorization"

    /// The header fields as they go on the request.
    public var fields: [String: String] {
        var fields = [Self.authorizationField: "Bearer \(bearer)"]
        if let deviceId { fields[VoiceServiceHeader.deviceId.rawValue] = deviceId }
        return fields
    }
}

/// How an open ended: with the socket standing, with the upgrade refused by
/// a status, or with a transport that carried nothing to an answer.
public enum VoiceSocketOpening: Equatable, Sendable {
    case opened
    /// The server answered the upgrade with a status other than 101.
    case refused(status: Int)
    /// No status came back: the attempt ended in a transport error, named by nothing it carried.
    case failed
}

/// What the far side of a socket handed up: one text frame, or the close that
/// ended it, with the close frame's code where one arrived.
public enum VoiceSocketArrival: Equatable, Sendable {
    case frame(String)
    case closed(code: Int?)
}

/// One WebSocket to the voice service. `open` settles once the handshake
/// has; a socket the caller closes answers `closed` to whoever is receiving.
/// Both waits return promptly when the task awaiting them is cancelled, which
/// is how the client's deadline lets go of a socket that never answers.
public protocol VoiceSocket: AnyObject, Sendable {
    func open() async -> VoiceSocketOpening
    func send(_ text: String) async throws
    func receive() async -> VoiceSocketArrival
    func close()
}

/// Makes the socket for one connection; the URL and headers are the handshake's whole.
public protocol VoiceSocketOpener: Sendable {
    func socket(url: URL, headers: VoiceHandshakeHeaders) -> any VoiceSocket
}

/// The close code of a connection that ended because the session did, after which nothing is tried again.
let normalSocketCloseCode = 1000

// MARK: - URLSession

/// The production opener: one `URLSessionWebSocketTask` per connection, on a
/// session of its own whose delegate reports the handshake's outcome.
public struct URLSessionVoiceSocketOpener: VoiceSocketOpener {
    public init() {}

    public func socket(url: URL, headers: VoiceHandshakeHeaders) -> any VoiceSocket {
        URLSessionVoiceSocket(url: url, headers: headers)
    }
}

/// The header set a `URLSessionWebSocketTask` handshake carries beyond the
/// ones set on its request is Foundation's own: `Host`, `Upgrade`,
/// `Connection`, `Sec-WebSocket-Key`, `Sec-WebSocket-Version`, and a
/// `User-Agent`. RFC 6455 §4.1 makes `Origin` a browser client's header, and
/// Apple documents no `Origin` default; `URLSessionVoiceSocket` sets exactly
/// `VoiceHandshakeHeaders.fields` and refuses to build a request holding one,
/// so the one thing a device pass has to confirm is that the service's
/// upgrade answers 101 rather than 403.
final class URLSessionVoiceSocket: NSObject, VoiceSocket, @unchecked Sendable {
    private let session: URLSession
    private let task: URLSessionWebSocketTask
    private let lock = NSLock()
    private var opening: VoiceSocketOpening?
    private var openWaiters: [CheckedContinuation<VoiceSocketOpening, Never>] = []

    static let originField = "Origin"

    init(url: URL, headers: VoiceHandshakeHeaders) {
        var request = URLRequest(url: url)
        for (field, value) in headers.fields {
            request.setValue(value, forHTTPHeaderField: field)
        }
        // The request carries the declared fields and nothing else; an `Origin` among them would be a 403.
        precondition(
            Set((request.allHTTPHeaderFields ?? [:]).keys) == Set(headers.fields.keys)
                && request.value(forHTTPHeaderField: Self.originField) == nil,
            "a voice handshake carries the declared headers alone"
        )
        let delegate = Delegate()
        session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        task = session.webSocketTask(with: request)
        super.init()
        delegate.socket = self
    }

    /// Settles with the handshake's outcome. A wait the client's deadline
    /// cancels ends the attempt: the task is cancelled and the wait answers
    /// `failed`, so no socket is left connecting behind a deadline that passed.
    func open() async -> VoiceSocketOpening {
        task.resume()
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
        try await task.send(.string(text))
    }

    /// The next frame, or the close that ended the socket. A wait the reader's
    /// cancellation ends closes the socket, since the reader is cancelled only
    /// by a hang-up or a deadline that is about to close it anyway.
    func receive() async -> VoiceSocketArrival {
        await withTaskCancellationHandler {
            do {
                switch try await task.receive() {
                case .string(let text): return .frame(text)
                case .data(let data): return .frame(String(decoding: data, as: UTF8.self))
                @unknown default: return .closed(code: closeCode)
                }
            } catch {
                return .closed(code: closeCode)
            }
        } onCancel: {
            close()
        }
    }

    /// A socket nobody holds any more is a connection nobody will read; it is
    /// closed rather than left to the service's own timeout.
    deinit {
        close()
    }

    /// Ends the connection and lets the session behind it go; safe to call
    /// more than once, and called for every connection this socket stood for
    /// however it ended, so no session outlives its one task.
    func close() {
        task.cancel(with: .normalClosure, reason: nil)
        session.invalidateAndCancel()
        settle(.failed)
    }

    /// The close frame's code once one arrived; nothing while the socket stands or ended without one.
    private var closeCode: Int? {
        let code = task.closeCode
        return code == .invalid ? nil : code.rawValue
    }

    /// The handshake's outcome, told once to every waiter and kept for any that asks later.
    fileprivate func settle(_ outcome: VoiceSocketOpening) {
        let waiters: [CheckedContinuation<VoiceSocketOpening, Never>] = lock.withLock {
            guard opening == nil else { return [] }
            opening = outcome
            let waiting = openWaiters
            openWaiters = []
            return waiting
        }
        for waiter in waiters { waiter.resume(returning: outcome) }
    }

    /// A task that ended before its handshake opened is refused by the status
    /// the upgrade answered with, or failed where nothing answered.
    fileprivate func settleFromCompletion() {
        if let status = (task.response as? HTTPURLResponse)?.statusCode, status != 101 {
            settle(.refused(status: status))
        } else {
            settle(.failed)
        }
    }

    private final class Delegate: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
        weak var socket: URLSessionVoiceSocket?

        func urlSession(
            _ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?
        ) {
            socket?.settle(.opened)
        }

        func urlSession(
            _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
            didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
        ) {
            // A close before the handshake opened is an attempt that carried nothing to an answer.
            socket?.settle(.failed)
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
            socket?.settleFromCompletion()
        }
    }
}
