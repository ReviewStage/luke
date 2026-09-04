import Foundation
import Observation

// MARK: - One line of the thread

/// One line of the conversation Luke holds with the developer on this phone:
/// the developer's ask — spoken and transcribed by the voice service, or
/// typed into the composer — or the words Luke spoke back.
public struct VoiceConversationMessage: Identifiable, Equatable, Sendable {
    public enum Speaker: Equatable, Sendable {
        case developer
        case luke
    }

    public let id: UUID
    public let turnId: UUID
    public let speaker: Speaker
    public var words: String
    /// Whether the developer typed these words rather than speaking them, so
    /// the context re-feed can lead with the same distinction the desktop's
    /// history keeps.
    public let typed: Bool

    public init(turnId: UUID, speaker: Speaker, words: String, typed: Bool = false) {
        id = UUID()
        self.turnId = turnId
        self.speaker = speaker
        self.words = words
        self.typed = typed
    }
}

// MARK: - The thread

/// The conversation Luke holds with the developer, kept outside any one voice
/// call and outside the voice screen. A Realtime call is a transport that
/// comes and goes — a voice change remints it, the idle timeout retires it —
/// and the screen is a way of looking at the thread, not its owner: popping
/// back to the sessions list must not erase what was said. Owned at app scope
/// and injected into the voice screen, the same continuity the desktop keeps
/// by holding its thread outside the call. Held in memory only: nothing here
/// reaches a file, and quitting the app is the end of the record.
@Observable
@MainActor
public final class VoiceConversationThread {
    /// How much of the thread stays, the desktop's stored bound transcribed.
    /// It exists so a long day of conversation cannot grow this object and
    /// the screen's scrollback without limit; every retained line's words
    /// stay whole, because the thread is the developer's own record.
    public static let maximumRetainedMessages = 200

    public private(set) var messages: [VoiceConversationMessage] = []

    private var activeTurnId: UUID?
    private var activeResponseMessageId: UUID?

    public init() {}

    /// Marks a developer press: the ask and reply that follow belong to one
    /// turn, which is what lets a transcript arriving late find its place.
    public func beginTurn() {
        activeTurnId = UUID()
        activeResponseMessageId = nil
    }

    /// Records the developer's transcribed words. The transcription arrives
    /// on the service's own clock — usually while the reply is already
    /// streaming — so the ask is placed before its own turn's reply rather
    /// than appended after it, and a fuller transcription of the same turn
    /// replaces the words rather than repeating the ask.
    public func recordSpokenAsk(_ text: String) {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        let turnId = currentTurnId()
        if let index = messages.firstIndex(where: {
            $0.turnId == turnId && $0.speaker == .developer
        }) {
            // A typed ask is already its author's whole words: a transcript
            // landing on its turn is a spoken turn's late arrival, not a
            // fuller version of what was typed.
            if !messages[index].typed { messages[index].words = words }
            return
        }
        let message = VoiceConversationMessage(turnId: turnId, speaker: .developer, words: words)
        if let responseIndex = messages.firstIndex(where: {
            $0.turnId == turnId && $0.speaker == .luke
        }) {
            messages.insert(message, at: responseIndex)
        } else {
            messages.append(message)
        }
        retainRecentMessages()
    }

    /// Records the developer's typed ask and opens its turn in one move:
    /// unlike a spoken ask, the words arrive whole at the moment of the send,
    /// on no service clock, so the turn and its ask land together and no
    /// fuller version ever follows to replace them.
    public func recordTypedAsk(_ text: String) {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        beginTurn()
        messages.append(
            VoiceConversationMessage(
                turnId: currentTurnId(), speaker: .developer, words: words, typed: true
            )
        )
        retainRecentMessages()
    }

    /// Records the running caption of the reply being spoken; nil ends the
    /// streaming segment so a tool follow-up gets its own bubble.
    public func recordCaption(_ text: String?) {
        guard let text, !text.isEmpty else {
            activeResponseMessageId = nil
            return
        }
        if let id = activeResponseMessageId,
           let index = messages.firstIndex(where: { $0.id == id })
        {
            messages[index].words = text
            return
        }
        let message = VoiceConversationMessage(
            turnId: currentTurnId(),
            speaker: .luke,
            words: text
        )
        messages.append(message)
        activeResponseMessageId = message.id
        retainRecentMessages()
    }

    /// Empties the thread at the developer's sign-out. The record is the
    /// signed-in developer's own: on a shared phone the next account must not
    /// inherit it, on screen or anywhere a later call could carry it.
    public func clear() {
        messages = []
        activeTurnId = nil
        activeResponseMessageId = nil
    }

    private func currentTurnId() -> UUID {
        if let activeTurnId { return activeTurnId }
        let id = UUID()
        activeTurnId = id
        return id
    }

    private func retainRecentMessages() {
        let excess = messages.count - Self.maximumRetainedMessages
        if excess > 0 { messages.removeFirst(excess) }
    }
}
