import Foundation

/// The roles a stored message may carry — `MESSAGE_ROLE` in `@sidecar/wire`.
public enum MessageRole: String, Sendable {
    case user
    case assistant
    case system
}

/// Who wrote a message — `MESSAGE_AUTHOR` in `@sidecar/wire`.
public enum MessageAuthor: String, Sendable {
    case developer
    case brain
    case voiceModel = "voice_model"
    case child
}

/// How a developer's ask arrived — `MESSAGE_CHANNEL` in `@sidecar/wire`.
public enum MessageChannel: String, Sendable {
    case typed
    case voice
}

/// What the brain wrote a user row down for itself about — `OBSERVATION_SOURCE`
/// in `@sidecar/wire`.
public enum ObservationSource: String, Sendable {
    case hook
    case rosterLook = "roster_look"
    case holdRelease = "hold_release"
    case child
    case childCompletion = "child_completion"
    case recalledNotes = "recalled_notes"
    case activityNotices = "activity_notices"
}

/// The states a stored tool part may carry — `TOOL_PART_STATE` in
/// `@sidecar/session`. The SDK names more; a stored row carries none of
/// those, so a part outside this set refuses the message rather than reading
/// as one of them.
public enum ToolPartState: String, Sendable {
    case inputStreaming = "input-streaming"
    case inputAvailable = "input-available"
    case outputAvailable = "output-available"
    case outputError = "output-error"
}

/// A spoken ask's metadata: whose words, cut from which session and
/// delegation, over which span of that session's clock.
public struct SpokenAskMetadata: Equatable, Sendable {
    public let author: MessageAuthor
    public let voiceSessionId: String?
    public let delegationId: String?
    public let fromMs: Int?
    public let toMs: Int?

    init(
        author: MessageAuthor,
        voiceSessionId: String? = nil,
        delegationId: String? = nil,
        fromMs: Int? = nil,
        toMs: Int? = nil
    ) {
        self.author = author
        self.voiceSessionId = voiceSessionId
        self.delegationId = delegationId
        self.fromMs = fromMs
        self.toMs = toMs
    }
}

/// What a user row says about itself — `USER_MESSAGE_METADATA` in
/// `@sidecar/wire`: the developer's typed ask, a spoken ask, or an
/// observation the brain wrote down for itself.
public enum UserMessageMetadata: Equatable, Sendable {
    case typedAsk
    case spokenAsk(SpokenAskMetadata)
    case observation(ObservationSource)

    public var author: MessageAuthor {
        switch self {
        case .typedAsk: .developer
        case .spokenAsk(let spoken): spoken.author
        case .observation: .brain
        }
    }
}

/// A compaction row's account of what it folded — `COMPACTION_METADATA`.
public struct CompactionMetadata: Equatable, Sendable {
    public let firstKeptMessageId: String
    public let tokensBefore: Int?
}

/// What an assistant row says about itself — `ASSISTANT_MESSAGE_METADATA`.
public struct AssistantMessageMetadata: Equatable, Sendable {
    public let author: MessageAuthor
    public let compaction: CompactionMetadata?

    init(author: MessageAuthor, compaction: CompactionMetadata? = nil) {
        self.author = author
        self.compaction = compaction
    }
}

/// A stored message's role with the metadata that role carries, one case per
/// role so a user row without its attribution or a system row with one has
/// no shape to arrive in.
public enum UIMessageAttribution: Equatable, Sendable {
    case user(UserMessageMetadata)
    case assistant(AssistantMessageMetadata)
    case system

    public var role: MessageRole {
        switch self {
        case .user: .user
        case .assistant: .assistant
        case .system: .system
        }
    }
}

/// A tool call as an assistant message's part records it: written in
/// `input-available` before the call runs and moved to `output-available` or
/// `output-error` after, so the part is the journal of the call. The input is
/// the call's own arguments and the output whatever the tool answered; both
/// are carried as JSON for the reader that knows their shape.
public struct ToolPart: Equatable, Sendable {
    public let toolName: String
    public let toolCallId: String
    public let state: ToolPartState
    public let input: JSONValue?
    public let output: JSONValue?
    public let errorText: String?

    init(
        toolName: String,
        toolCallId: String,
        state: ToolPartState,
        input: JSONValue? = nil,
        output: JSONValue? = nil,
        errorText: String? = nil
    ) {
        self.toolName = toolName
        self.toolCallId = toolCallId
        self.state = state
        self.input = input
        self.output = output
        self.errorText = errorText
    }
}

/// One part of a stored message, as the AI SDK spells them: the two drawn as
/// words, the step marker, a tool call, and every other kind the SDK may
/// write — a file, a source, a data part — kept by its type alone, since this
/// build draws none of them and a message is not malformed for carrying one.
public enum UIMessagePart: Equatable, Sendable {
    case text(String)
    case reasoning(String)
    case stepStart
    case tool(ToolPart)
    case other(type: String)
}

/// A stored message as the phone reads it back: the SDK's `UIMessage`, its
/// role deciding which metadata it carries, mirroring `readStoredUIMessages`
/// in `@sidecar/session`. The service validated every row before answering,
/// so a message this decoder refuses is one a newer service wrote in a shape
/// this build does not read, and the page is refused rather than thinned.
public struct UIMessage: Equatable, Sendable, Identifiable {
    public let id: String
    public let attribution: UIMessageAttribution
    public let parts: [UIMessagePart]

    public var role: MessageRole { attribution.role }

    /// The tool calls the message carries, in part order.
    public var toolParts: [ToolPart] {
        parts.compactMap { part in
            if case .tool(let tool) = part { return tool }
            return nil
        }
    }
}

// MARK: - Decoding

extension UIMessage: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, role, metadata, parts
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        let roleText = try container.decode(String.self, forKey: .role)
        guard let role = MessageRole(rawValue: roleText) else {
            throw DecodingError.dataCorruptedError(
                forKey: .role, in: container, debugDescription: "unknown role \(roleText)"
            )
        }
        let metadata = try container.decodeIfPresent(JSONValue.self, forKey: .metadata)
        attribution = try Self.attribution(role: role, metadata: metadata, container: container)
        parts = try container.decode([UIMessagePart].self, forKey: .parts)
    }

    private static func attribution(
        role: MessageRole,
        metadata: JSONValue?,
        container: KeyedDecodingContainer<CodingKeys>
    ) throws -> UIMessageAttribution {
        func malformed(_ description: String) -> DecodingError {
            DecodingError.dataCorruptedError(
                forKey: .metadata, in: container, debugDescription: description
            )
        }
        switch role {
        case .system:
            guard metadata == nil else { throw malformed("a system row carries no metadata") }
            return .system
        case .user:
            guard let metadata, let user = UserMessageMetadata(json: metadata) else {
                throw malformed("a user row's metadata is not an ask or an observation")
            }
            return .user(user)
        case .assistant:
            guard let metadata, let assistant = AssistantMessageMetadata(json: metadata) else {
                throw malformed("an assistant row's metadata names no author")
            }
            return .assistant(assistant)
        }
    }
}

extension UserMessageMetadata {
    private enum Key {
        static let author = "author"
        static let channel = "channel"
        static let source = "source"
        static let voiceSessionId = "voice_session_id"
        static let delegationId = "delegation_id"
        static let fromMs = "from_ms"
        static let toMs = "to_ms"
    }

    /// The three records of `USER_MESSAGE_METADATA`, told apart by the keys
    /// each carries: an author and a channel for an ask, an author and a
    /// source for an observation. Anything else is no user metadata at all.
    init?(json: JSONValue) {
        guard let author = json[Key.author]?.stringValue.flatMap(MessageAuthor.init(rawValue:)) else {
            return nil
        }
        if let source = json[Key.source]?.stringValue {
            guard author == .brain, json[Key.channel] == nil,
                  let observation = ObservationSource(rawValue: source)
            else { return nil }
            self = .observation(observation)
            return
        }
        guard let channel = json[Key.channel]?.stringValue.flatMap(MessageChannel.init(rawValue:)) else {
            return nil
        }
        switch channel {
        case .typed:
            guard author == .developer else { return nil }
            self = .typedAsk
        case .voice:
            guard author == .developer || author == .voiceModel else { return nil }
            let fromMs = json[Key.fromMs]?.numberValue.flatMap(Self.spanInstant)
            let toMs = json[Key.toMs]?.numberValue.flatMap(Self.spanInstant)
            guard Self.coherentSpan(from: fromMs, to: toMs) else { return nil }
            self = .spokenAsk(
                SpokenAskMetadata(
                    author: author,
                    voiceSessionId: json[Key.voiceSessionId]?.stringValue,
                    delegationId: json[Key.delegationId]?.stringValue,
                    fromMs: fromMs,
                    toMs: toMs
                )
            )
        }
    }

    private static func spanInstant(_ value: Double) -> Int? {
        guard value >= 0, value == value.rounded() else { return nil }
        return Int(value)
    }

    /// The span's two ends come together or not at all, and run forward.
    private static func coherentSpan(from: Int?, to: Int?) -> Bool {
        guard let from, let to else { return from == nil && to == nil }
        return from <= to
    }
}

extension AssistantMessageMetadata {
    private enum Key {
        static let author = "author"
        static let compaction = "compaction"
        static let firstKeptMessageId = "first_kept_message_id"
        static let tokensBefore = "tokens_before"
    }

    private static let authors: Set<MessageAuthor> = [.brain, .voiceModel, .child]

    init?(json: JSONValue) {
        guard let author = json[Key.author]?.stringValue.flatMap(MessageAuthor.init(rawValue:)),
              Self.authors.contains(author)
        else { return nil }
        var compaction: CompactionMetadata?
        if let folded = json[Key.compaction] {
            guard let firstKept = folded[Key.firstKeptMessageId]?.stringValue else { return nil }
            var tokensBefore: Int?
            if let tokens = folded[Key.tokensBefore] {
                guard let count = tokens.numberValue, count >= 0, count == count.rounded() else {
                    return nil
                }
                tokensBefore = Int(count)
            }
            compaction = CompactionMetadata(firstKeptMessageId: firstKept, tokensBefore: tokensBefore)
        }
        self.init(author: author, compaction: compaction)
    }
}

extension UIMessagePart: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, text, toolCallId, state, input, output, errorText
    }

    /// How the SDK spells a static tool part's type: the tool's name behind this prefix.
    private static let toolTypePrefix = "tool-"
    /// The type the SDK gives a part naming no registered tool; a stored row never carries one.
    private static let dynamicToolType = "dynamic-tool"

    private enum PartType: String {
        case text
        case reasoning
        case stepStart = "step-start"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        if type.hasPrefix(Self.toolTypePrefix) {
            let stateText = try container.decode(String.self, forKey: .state)
            guard let state = ToolPartState(rawValue: stateText) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .state, in: container,
                    debugDescription: "a stored tool part never carries state \(stateText)"
                )
            }
            self = .tool(
                ToolPart(
                    toolName: String(type.dropFirst(Self.toolTypePrefix.count)),
                    toolCallId: try container.decode(String.self, forKey: .toolCallId),
                    state: state,
                    input: try container.decodeIfPresent(JSONValue.self, forKey: .input),
                    output: try container.decodeIfPresent(JSONValue.self, forKey: .output),
                    errorText: try container.decodeIfPresent(String.self, forKey: .errorText)
                )
            )
            return
        }
        if type == Self.dynamicToolType {
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container,
                debugDescription: "a stored row names every tool it calls"
            )
        }
        switch PartType(rawValue: type) {
        case .text:
            self = .text(try container.decode(String.self, forKey: .text))
        case .reasoning:
            self = .reasoning(try container.decode(String.self, forKey: .text))
        case .stepStart:
            self = .stepStart
        case nil:
            self = .other(type: type)
        }
    }
}
