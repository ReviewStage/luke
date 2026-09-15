import Foundation

/// Whose words a transcript fragment carries — `TRANSCRIPT_SPEAKER` in
/// `packages/live/src/transcript.ts`.
public enum LiveTranscriptSpeaker: String, CaseIterable, Sendable {
    case user
    case assistant
}

/// The two bounds the desktop groups and settles utterances on, kept to the
/// millisecond so the phone's captions and the record the service writes agree
/// on what an utterance is.
public enum LiveTranscriptBounds {
    /// `UTTERANCE_GAP_MS`: the silence between two of one speaker's fragments that starts a new utterance.
    public static let utteranceGapMs = 1200
    /// `UTTERANCE_SETTLE_MARGIN_MS`: after the gap, how long a late fragment is still waited for before a row settles.
    public static let utteranceSettleMarginMs = 800
}

/// One caption row: whose it is and its words so far — the desktop's
/// `LiveCaptionRow`.
public struct LiveCaptionRow: Equatable, Sendable, Identifiable {
    /// Assigned once when the row opens and never moved, so a late fragment grows a row in place.
    public let rowId: Int
    public let speaker: LiveTranscriptSpeaker
    /// The fragments' text concatenated exactly as received, in arrival order.
    public let words: String

    public var id: Int { rowId }

    public init(rowId: Int, speaker: LiveTranscriptSpeaker, words: String) {
        self.rowId = rowId
        self.speaker = speaker
        self.words = words
    }
}

/// Both speakers' words as the transcript deltas carry them, grouped the way
/// the desktop's `TranscriptLedger` groups them and drawn the way its
/// `LiveCaptions` draws them. The API gives no turn boundary and no item id,
/// and the captions recipe forbids reading silence into a missing event, so
/// every fragment is kept exactly as received with its place on the session
/// timeline and joins the utterance of the same speaker its timestamps put it
/// in, wherever that utterance sits; a fragment more than the gap from every
/// utterance opens a new row. A row settles once no fragment has joined it
/// for the gap plus the margin, measured on this phone's clock rather than
/// the session's, since a fragment's arrival is what the drawing follows.
@MainActor
public final class LiveCaptions {
    private struct Group {
        let rowId: Int
        let speaker: LiveTranscriptSpeaker
        var words: String
        var startMs: Int
        var endMs: Int
        var lastArrival: Date
    }

    private let now: @MainActor () -> Date
    private var groups: [Group] = []
    private var nextRowId = 1

    public init(now: @MainActor @escaping () -> Date = Date.init) {
        self.now = now
    }

    /// Records one fragment; the row it joined or opened, or nothing for a
    /// fragment whose end precedes its start.
    @discardableResult
    public func append(_ speaker: LiveTranscriptSpeaker, _ delta: LiveTranscriptDelta) -> LiveCaptionRow? {
        guard delta.endMs >= delta.startMs else { return nil }
        let arrived = now()
        let index = groupIndex(for: speaker, delta) ?? openGroup(speaker, delta, at: arrived)
        groups[index].words += delta.delta
        groups[index].startMs = min(groups[index].startMs, delta.startMs)
        groups[index].endMs = max(groups[index].endMs, delta.endMs)
        groups[index].lastArrival = arrived
        return row(groups[index])
    }

    /// Every utterance as a row, in the order the rows were opened.
    public var rows: [LiveCaptionRow] {
        groups.map { row($0) }
    }

    /// Whether a fragment may still join any row, so the caller knows to read the rows again later.
    public var unsettled: Bool {
        let instant = now()
        return groups.contains { !settled($0, at: instant) }
    }

    /// The nearest utterance of the same speaker within the gap, wherever it sits.
    private func groupIndex(for speaker: LiveTranscriptSpeaker, _ delta: LiveTranscriptDelta) -> Int? {
        var nearest: Int?
        var nearestDistance = Int.max
        for (index, group) in groups.enumerated() where group.speaker == speaker {
            let distance =
                delta.startMs > group.endMs
                ? delta.startMs - group.endMs
                : delta.endMs < group.startMs ? group.startMs - delta.endMs : 0
            if distance <= LiveTranscriptBounds.utteranceGapMs, distance < nearestDistance {
                nearest = index
                nearestDistance = distance
            }
        }
        return nearest
    }

    private func openGroup(_ speaker: LiveTranscriptSpeaker, _ delta: LiveTranscriptDelta, at arrived: Date) -> Int {
        groups.append(
            Group(
                rowId: nextRowId, speaker: speaker, words: "", startMs: delta.startMs, endMs: delta.endMs,
                lastArrival: arrived
            )
        )
        nextRowId += 1
        return groups.count - 1
    }

    private func row(_ group: Group) -> LiveCaptionRow {
        LiveCaptionRow(rowId: group.rowId, speaker: group.speaker, words: group.words)
    }

    private func settled(_ group: Group, at instant: Date) -> Bool {
        let quiet = instant.timeIntervalSince(group.lastArrival) * 1000
        return quiet >= Double(LiveTranscriptBounds.utteranceGapMs + LiveTranscriptBounds.utteranceSettleMarginMs)
    }
}
