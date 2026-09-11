import Foundation

/// A stored row the service could not read back, named as the refusal names
/// it: the page it stood on was refused whole rather than thinned, and the
/// screen says so rather than drawing an empty thread.
public struct UnreadableRow: Equatable, Sendable {
    public let conversationId: String
    public let seq: Int

    public init(conversationId: String, seq: Int) {
        self.conversationId = conversationId
        self.seq = seq
    }
}

public enum ConversationReadError: Error, Equatable, HostedUnauthorizedSignaling {
    /// The answer was not the shape the wire contract promises; discarded
    /// rather than repaired, the posture of the readers in `@sidecar/hosted`.
    case invalidResponse
    case unauthorized
    /// `HOSTED_API_ERROR.UNREADABLE_ROW`: a page refused over one row it
    /// names. Never an empty page.
    case unreadableRow(UnreadableRow)
    case serverError(status: Int, apiError: HostedAPIError?)

    public var isUnauthorized: Bool { self == .unauthorized }
}

/// The phone's side of the per-resource reads and the change signal —
/// `reads-wire.ts` in `@sidecar/hosted`, at the paths `HOSTED_SERVICE_PATH`
/// names. Every cursor is the string the last answer handed back, echoed
/// unchanged; nothing here composes one.
public final class ConversationReadClient: Sendable {
    /// `HOSTED_SERVICE_PATH.CONVERSATION_MESSAGES`, without its leading slash.
    public static let messagesPath = "api/conversation/messages"
    /// `HOSTED_SERVICE_PATH.CONVERSATION_EVENTS`.
    public static let eventsPath = "api/conversation/events"
    /// `HOSTED_SERVICE_PATH.BRAIN_TURNS`.
    public static let turnsPath = "api/brain/turns"
    /// `HOSTED_SERVICE_PATH.CHANGES`.
    public static let changesPath = "api/changes"
    /// `READ_PAGE_BOUNDS.MAX_LIMIT`: the most rows one page passes.
    public static let maximumPageLimit = 200

    private enum Query {
        static let after = "after"
        static let limit = "limit"
    }

    private let serviceURL: URL
    private let http: HTTPClient
    private let decoder = JSONDecoder()

    public init(serviceURL: URL, http: HTTPClient = URLSession.shared) {
        self.serviceURL = serviceURL
        self.http = http
    }

    /// GET the Conversation's messages behind the cursor, or from the
    /// beginning for none.
    public func messages(after cursor: String?, accessToken: String) async throws -> ConversationMessagesAnswer {
        try await read(path: Self.messagesPath, after: cursor, accessToken: accessToken)
    }

    /// GET the events about the Conversation's messages behind the cursor.
    public func events(after cursor: String?, accessToken: String) async throws -> ConversationEventsAnswer {
        try await read(path: Self.eventsPath, after: cursor, accessToken: accessToken)
    }

    /// GET the account's turns in the order they last changed, behind the cursor.
    public func turns(after cursor: String?, accessToken: String) async throws -> BrainTurnsAnswer {
        try await read(path: Self.turnsPath, after: cursor, accessToken: accessToken)
    }

    /// POST the change signal: where every resource stands now, reported
    /// against this device, whose presence holds until `activeUntil`. The
    /// phone reports no quiet instant: it observes no meeting hold.
    public func changes(deviceId: String, activeUntil: Date, accessToken: String) async throws -> ChangesAnswer {
        var request = URLRequest(url: serviceURL.appendingPathComponent(Self.changesPath))
        request.httpMethod = "POST"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "deviceId": deviceId,
            "activeUntil": Int(activeUntil.timeIntervalSince1970 * 1000),
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await answer(for: request)
    }

    private func read<Answer: Decodable>(
        path: String, after cursor: String?, accessToken: String
    ) async throws -> Answer {
        var components = URLComponents(
            url: serviceURL.appendingPathComponent(path), resolvingAgainstBaseURL: false
        )
        var query = [URLQueryItem(name: Query.limit, value: String(Self.maximumPageLimit))]
        if let cursor { query.append(URLQueryItem(name: Query.after, value: cursor)) }
        components?.queryItems = query
        guard let url = components?.url else { throw ConversationReadError.invalidResponse }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        return try await answer(for: request)
    }

    private func answer<Answer: Decodable>(for request: URLRequest) async throws -> Answer {
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw ConversationReadError.unauthorized }
        guard (200 ..< 300).contains(status) else {
            let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
            let reason = (json["error"] as? String).flatMap(HostedAPIError.init(rawValue:))
            if reason == .unreadableRow, let row = Self.unreadableRow(json["unreadableRow"]) {
                throw ConversationReadError.unreadableRow(row)
            }
            throw ConversationReadError.serverError(status: status, apiError: reason)
        }
        do {
            return try decoder.decode(Answer.self, from: data)
        } catch {
            throw ConversationReadError.invalidResponse
        }
    }

    private static func unreadableRow(_ value: Any?) -> UnreadableRow? {
        guard let row = value as? [String: Any],
              let conversationId = row["conversationId"] as? String,
              let seq = row["seq"] as? Int
        else { return nil }
        return UnreadableRow(conversationId: conversationId, seq: seq)
    }
}
