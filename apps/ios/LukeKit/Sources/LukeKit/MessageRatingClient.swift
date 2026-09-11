import Foundation

/// The developer's verdict on one of Luke's messages — `MESSAGE_RATING` in
/// `@sidecar/wire`, the stored event's own two words.
public enum MessageRating: String, Sendable {
    case up
    case down
}

/// What recording a rating answers — `HostedMessageRatingAnswer`: the event
/// row's id and its place in the conversation's event sequence.
public struct MessageRatingAnswer: Equatable, Sendable {
    public let id: String
    public let seq: Int
}

public enum MessageRatingError: Error, Equatable, HostedUnauthorizedSignaling {
    /// The answer was not the shape the wire contract promises.
    case invalidResponse
    case unauthorized
    /// `HOSTED_API_ERROR.NOT_FOUND`: no message by that id stands for this account — another's, none, or one a Clear took.
    case notFound
    /// `HOSTED_API_ERROR.NOT_RATEABLE`: the message is the account's but not one of Luke's words.
    case notRateable
    case serverError(status: Int, apiError: HostedAPIError?)

    public var isUnauthorized: Bool { self == .unauthorized }
}

/// The phone's side of `PUT /api/conversation/messages/{id}/rating` —
/// `rating-wire.ts` in `@sidecar/hosted`. A rating is a fact the developer
/// states about one of Luke's messages from this device, appended as an
/// event beside the message and never an update: a second verdict is a
/// second event, and a read takes the newer. The request carries the verdict
/// and the device alone; the wire's optional note is the developer's free
/// text, and this build offers no field to type one.
public final class MessageRatingClient: Sendable {
    /// `conversationMessageRatingPath` in `@sidecar/hosted`, around the message's id: the path's head, without its leading slash, and its tail.
    public static let pathHead = "api/conversation/messages"
    public static let pathTail = "rating"

    private let serviceURL: URL
    private let http: HTTPClient

    public init(serviceURL: URL, http: HTTPClient = URLSession.shared) {
        self.serviceURL = serviceURL
        self.http = http
    }

    public func rate(
        messageId: String,
        _ rating: MessageRating,
        deviceId: String,
        accessToken: String
    ) async throws -> MessageRatingAnswer {
        let url = serviceURL
            .appendingPathComponent(Self.pathHead)
            .appendingPathComponent(messageId)
            .appendingPathComponent(Self.pathTail)
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(
            withJSONObject: ["rating": rating.rawValue, "deviceId": deviceId]
        )
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw MessageRatingError.unauthorized }
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard (200 ..< 300).contains(status) else {
            let reason = (json["error"] as? String).flatMap(HostedAPIError.init(rawValue:))
            switch reason {
            case .notFound: throw MessageRatingError.notFound
            case .notRateable: throw MessageRatingError.notRateable
            default: throw MessageRatingError.serverError(status: status, apiError: reason)
            }
        }
        guard let id = json["id"] as? String, !id.isEmpty, let seq = json["seq"] as? Int, seq >= 1 else {
            throw MessageRatingError.invalidResponse
        }
        return MessageRatingAnswer(id: id, seq: seq)
    }
}
