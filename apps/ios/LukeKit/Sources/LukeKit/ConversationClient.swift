import Foundation

/// Who wrote one message of a conversation reading. Mirrors
/// `CONVERSATION_MESSAGE_AUTHOR` in `@sidecar/session`, the same set the
/// hosted wire types with: only the two voices a chat screen draws exist on
/// the wire, because a message the provider's store did not attribute never
/// left the server's adapter at all.
public enum ConversationAuthor: String, Sendable {
    case user
    case agent
}

/// One attributed message of a session's conversation, as the messages
/// endpoint relays it. Mirrors the `HostedConversationMessage` wire shape
/// from `@sidecar/hosted`: the provider's own id, who wrote it, and the
/// words whole — the read's bounds live on the page, never on the message.
public struct ConversationMessage: Identifiable, Equatable, Sendable {
    public let id: String
    public let author: ConversationAuthor
    public let text: String
    /// When the provider recorded the message, when it reported one.
    public let receivedAt: Date?

    public init(id: String, author: ConversationAuthor, text: String, receivedAt: Date? = nil) {
        self.id = id
        self.author = author
        self.text = text
        self.receivedAt = receivedAt
    }

    init?(json: [String: Any]) {
        guard
            let id = json["id"] as? String, !id.isEmpty,
            let rawAuthor = json["author"] as? String,
            let author = ConversationAuthor(rawValue: rawAuthor),
            let text = json["text"] as? String, !text.isEmpty
        else { return nil }
        self.id = id
        self.author = author
        self.text = text
        if let ms = json["receivedAt"] as? Double {
            self.receivedAt = Date(timeIntervalSince1970: ms / 1000)
        } else {
            self.receivedAt = nil
        }
    }
}

/// Where one conversation read stands, the way a chat screen reads: the
/// latest page when the screen opens, only what is newer when it polls, and
/// the history just before what it holds when a scroll reaches the top. One
/// read names one position, so the two cursors cannot combine.
public enum ConversationPosition: Equatable, Sendable {
    case latest
    case after(String)
    case before(Int)
}

/// The messages endpoint answer: one bounded page of attributed messages and
/// the positions to continue from. `lastMessageId` is where a poll resumes —
/// absent on an older-history page, which must never move a poll backward —
/// and `firstOffset`/`hasOlder` are where a scroll to the top continues,
/// absent on a poll, which never looks backward.
/// Mirrors the `HostedConversationAnswer` wire shape from `@sidecar/hosted`.
public struct ConversationAnswer: Equatable, Sendable {
    public let messages: [ConversationMessage]
    public let lastMessageId: String?
    public let hasMore: Bool
    public let firstOffset: Int?
    public let hasOlder: Bool

    public init(
        messages: [ConversationMessage],
        lastMessageId: String?,
        hasMore: Bool,
        firstOffset: Int? = nil,
        hasOlder: Bool = false
    ) {
        self.messages = messages
        self.lastMessageId = lastMessageId
        self.hasMore = hasMore
        self.firstOffset = firstOffset
        self.hasOlder = hasOlder
    }
}

public enum ConversationClientError: Error, Equatable {
    case invalidResponse
    case unauthorized
    case serverError(status: Int)
}

extension ConversationClientError: HostedUnauthorizedSignaling {
    public var isUnauthorized: Bool { self == .unauthorized }
}

/// Reads one session's conversation from the hosted messages endpoint.
///
/// The read is on-demand and read-only: the server runs a fresh observation
/// pass, reads the provider's own documented transcript endpoint under the
/// caller's synced key, and stores nothing. The screen asks when it opens
/// and polls with the returned cursor while it stays open; a session whose
/// roster row did not advertise `canReadConversation` is never asked for.
public final class ConversationClient: Sendable {
    private let serviceURL: URL
    private let http: HTTPClient

    public init(serviceURL: URL, http: HTTPClient = URLSession.shared) {
        self.serviceURL = serviceURL
        self.http = http
    }

    /// Returns one bounded page of the session's conversation at the named
    /// position: the latest page, only what is newer than a message, or the
    /// history ending at a stored offset an earlier answer reported.
    public func read(
        accessToken: String,
        providerId: String,
        providerSessionId: String,
        position: ConversationPosition = .latest
    ) async throws -> ConversationAnswer {
        var components = URLComponents(
            url: serviceURL.appendingPathComponent("api/sessions/messages"),
            resolvingAgainstBaseURL: false
        )
        var query = [
            URLQueryItem(name: "providerId", value: providerId),
            URLQueryItem(name: "providerSessionId", value: providerSessionId),
        ]
        switch position {
        case .latest:
            break
        case .after(let messageId):
            query.append(URLQueryItem(name: "after", value: messageId))
        case .before(let offset):
            query.append(URLQueryItem(name: "beforeOffset", value: String(offset)))
        }
        components?.queryItems = query
        guard let url = components?.url else { throw ConversationClientError.invalidResponse }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await http.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw ConversationClientError.unauthorized }
        guard (200 ..< 300).contains(status) else {
            throw ConversationClientError.serverError(status: status)
        }
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let messagesJSON = json["messages"] as? [[String: Any]],
            let hasMore = json["hasMore"] as? Bool
        else { throw ConversationClientError.invalidResponse }
        return ConversationAnswer(
            messages: messagesJSON.compactMap { ConversationMessage(json: $0) },
            lastMessageId: json["lastMessageId"] as? String,
            hasMore: hasMore,
            firstOffset: json["firstOffset"] as? Int,
            hasOlder: json["hasOlder"] as? Bool ?? false
        )
    }
}
