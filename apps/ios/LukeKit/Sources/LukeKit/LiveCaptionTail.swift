import Foundation

/// The live captions a screen draws at the tail of the stored Conversation
/// while a call stands. The service writes each utterance to the thread as it
/// settles, and the phone's next poll draws it as a durable row; the caption
/// that streamed the same words then says nothing the thread does not, so it
/// is dropped rather than drawn twice. A caption is matched to a durable row
/// by speaker and words within the thread's newest turns alone, which is
/// where the call's own utterances land.
public enum LiveCaptionTail {
    /// How many turns from the end of the thread a caption is looked for in.
    public static let turnsSearched = 4

    public static func rows(
        captions: [LiveCaptionRow],
        behind turns: [ConversationTurnRows]
    ) -> [LiveCaptionRow] {
        guard !captions.isEmpty else { return [] }
        var written: Set<Spoken> = []
        for turn in turns.suffix(turnsSearched) {
            for row in turn.rows {
                guard case .words(_, let speaker, let text, _, _, _) = row,
                      let live = LiveTranscriptSpeaker(speaker)
                else { continue }
                written.insert(Spoken(speaker: live, words: Self.trimmed(text)))
            }
        }
        return captions.filter {
            !written.contains(Spoken(speaker: $0.speaker, words: Self.trimmed($0.words)))
        }
    }

    private struct Spoken: Hashable {
        let speaker: LiveTranscriptSpeaker
        let words: String
    }

    private static func trimmed(_ words: String) -> String {
        words.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

extension LiveTranscriptSpeaker {
    /// The caption speaker a durable row's speaker stands for; nil for a row
    /// no caption ever streams (a note, Luke's own judgment).
    fileprivate init?(_ speaker: ConversationSpeaker) {
        switch speaker {
        case .you: self = .user
        case .luke: self = .assistant
        case .note, .own: return nil
        }
    }
}
