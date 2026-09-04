import Foundation

/// The one URLSession every hosted read and act on the watch travels on.
///
/// watchOS brings its network path up on demand and chooses it itself: the
/// paired iPhone's connection, tunneled over Bluetooth, whenever the phone is
/// in range; this watch's own Wi-Fi or cellular only when it is not. Nothing
/// an app does changes that order. What an app does decide is what happens
/// in the moment before a path is up: `URLSession.shared` fails the request
/// at once, which on the wrist reads as "The Internet connection appears to
/// be offline" with the iPhone in the same pocket. This session waits for a
/// path instead, bounded so a watch that truly has none still answers.
enum WatchNetwork {
    static let waitForPathSeconds: TimeInterval = 20

    static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForResource = waitForPathSeconds
        return URLSession(configuration: configuration)
    }()

    /// Words a failed request by what the wearer can do about it. A request
    /// that found no path within the wait surfaces as `.timedOut`, so that
    /// code belongs with the connection failures rather than the server's.
    static func describe(_ error: any Error) -> String {
        guard let urlError = error as? URLError else { return error.localizedDescription }
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut,
             .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
            return "Couldn't reach Luke. Keep your iPhone nearby, or join Wi-Fi."
        default:
            return urlError.localizedDescription
        }
    }
}

/// A connection failure carrying the wrist's own wording, for the one caller
/// that receives words rather than the error: the voice session's `onError`.
struct WatchNetworkFailure: LocalizedError {
    let errorDescription: String?

    init(_ error: URLError) {
        errorDescription = WatchNetwork.describe(error)
    }
}
