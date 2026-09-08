import Foundation

/// The date set over a line that followed a long silence, the way iMessage
/// dates a message that followed a long break. The desktop's rule
/// transcribed, so the three screens agree on when a break opens and how it
/// is worded.
public enum ConversationTimeBreak {
    /// How long a silence between two recorded lines has to be before the
    /// thread names the moment the next one was said. An hour is iMessage's
    /// own threshold: closer than that, a message answers the one before it,
    /// and the row's own stamp in the pull column is enough.
    public static let silence: TimeInterval = 60 * 60

    /// The past week's weekdays are unambiguous by name; a week on they are not.
    private static let weekdayNameDays = 7

    /// Whether the line recorded at `recordedAt` opens a break: the thread's
    /// first line always does, since the date of what the reader is looking
    /// at is the whole question, and a later one does when the silence before
    /// it reached the threshold.
    public static func opens(after previousRecordedAt: Date?, recordedAt: Date) -> Bool {
        guard let previousRecordedAt else { return true }
        return recordedAt.timeIntervalSince(previousRecordedAt) >= silence
    }

    public struct Label: Equatable, Sendable {
        /// The day, as a reader would name it: Today, Yesterday, a weekday, or a date.
        public let day: String
        /// The clock time on that day.
        public let time: String
    }

    /// Names the moment a break's line was said, read against `now`. The day
    /// is relative only while relative is exact — Today, Yesterday, then the
    /// weekday for the rest of the past week — and a date after that, with
    /// the year once the year is not this one, because the thread exists to
    /// say what date an old line is from and a bare weekday a fortnight on
    /// says nothing. The calendar decides the day the way the reader's clock
    /// does, so an evening line is dated by the reader's evening, not UTC's.
    public static func label(
        recordedAt: Date, now: Date, calendar: Calendar = .current, locale: Locale = .current
    ) -> Label {
        let style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: calendar.timeZone)
        let daysAgo =
            calendar.dateComponents(
                [.day], from: calendar.startOfDay(for: recordedAt), to: calendar.startOfDay(for: now)
            ).day ?? 0
        let day: String
        if daysAgo == 0 {
            day = "Today"
        } else if daysAgo == 1 {
            day = "Yesterday"
        } else if daysAgo > 1, daysAgo < weekdayNameDays {
            day = recordedAt.formatted(style.weekday(.wide))
        } else if calendar.component(.year, from: recordedAt) == calendar.component(.year, from: now) {
            day = recordedAt.formatted(style.weekday(.abbreviated).month(.abbreviated).day())
        } else {
            day = recordedAt.formatted(style.month(.abbreviated).day().year())
        }
        return Label(day: day, time: recordedAt.formatted(style.hour().minute()))
    }
}
