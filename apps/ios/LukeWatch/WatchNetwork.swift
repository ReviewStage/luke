import Foundation
import Network

/// The one URLSession every hosted read and act on the watch travels on.
///
/// HTTP through URLSession is the networking watchOS opens to every app; the
/// Realtime socket is the exception, and `WatchVoiceAudioSession` says on
/// what terms. watchOS brings the path up on demand and chooses it itself:
/// the paired iPhone's connection, tunneled over Bluetooth, whenever the
/// phone is in range; this watch's own Wi-Fi or cellular only when it is not.
/// What an app decides is the moment before a path is up: `URLSession.shared`
/// fails the request at once, which reads as offline with the iPhone in the
/// same pocket. This session waits for a path instead, bounded so a watch
/// that truly has none still answers.
enum WatchNetwork {
    /// The bound on one whole request, the wait for a path and the transfer
    /// that follows it together: URLSession offers no bound on the wait
    /// alone. It is long enough for a hosted observe or conversation read
    /// to cross a Bluetooth tunnel, and shorter than the wearer's patience
    /// with a screen that has said nothing.
    static let requestBoundSeconds: TimeInterval = 45

    static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForResource = requestBoundSeconds
        return URLSession(configuration: configuration)
    }()

    /// Words a failed request by what the wearer can do about it. A request
    /// that found no path within the bound surfaces as `.timedOut`, the same
    /// code a transfer that stalled on a live path ends in, so the sentence
    /// says only what both have in common: Luke was not reached, and the
    /// phone or Wi-Fi is where a path comes from.
    static func describe(_ error: any Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut,
                 .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
                return unreachable
            default:
                return urlError.localizedDescription
            }
        }
        if let nwError = error as? NWError {
            switch nwError {
            case .posix(.ENETDOWN), .posix(.ENETUNREACH), .posix(.EHOSTUNREACH),
                 .posix(.ETIMEDOUT), .posix(.ECONNREFUSED), .posix(.ECONNRESET), .dns:
                return unreachable
            default:
                return nwError.localizedDescription
            }
        }
        return error.localizedDescription
    }

    private static let unreachable = "Couldn't reach Luke. Keep your iPhone nearby, or join Wi-Fi."
}

/// A connection failure carrying the wrist's own wording, for the callers
/// that receive words rather than the error: the voice session's `onError`.
struct WatchNetworkFailure: LocalizedError {
    let errorDescription: String?

    init(_ error: any Error) {
        errorDescription = WatchNetwork.describe(error)
    }
}
