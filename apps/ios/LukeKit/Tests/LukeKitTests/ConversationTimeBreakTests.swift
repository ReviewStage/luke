import Foundation
import XCTest

@testable import LukeKit

final class ConversationTimeBreakTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_788_888_600) // 2026-09-08T17:30:00Z
    private let minute: TimeInterval = 60
    private let day: TimeInterval = 24 * 60 * 60

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }

    private func label(_ recordedAt: Date) -> ConversationTimeBreak.Label {
        let label = ConversationTimeBreak.label(
            recordedAt: recordedAt, now: now, calendar: calendar, locale: Locale(identifier: "en_US")
        )
        // Foundation sets a narrow no-break space before the period on some
        // systems; the words are what the test is about.
        return .init(day: label.day, time: label.time.replacingOccurrences(of: "\u{202F}", with: " "))
    }

    func testTheFirstLineOpensABreakAndASilenceOfAnHourOpensTheNext() {
        XCTAssertTrue(ConversationTimeBreak.opens(after: nil, recordedAt: now))
        XCTAssertFalse(ConversationTimeBreak.opens(after: now, recordedAt: now + 59 * minute))
        XCTAssertTrue(
            ConversationTimeBreak.opens(after: now, recordedAt: now + ConversationTimeBreak.silence)
        )
        XCTAssertTrue(ConversationTimeBreak.opens(after: now, recordedAt: now + day))
    }

    func testALineFromTodayIsNamedByItsTimeAloneUnderToday() {
        XCTAssertEqual(label(now - 3 * 60 * minute), .init(day: "Today", time: "7:30 AM"))
    }

    func testTheCalendarDayIsReadInTheReadersZoneNotUTC() {
        // 03:00 UTC on the 8th is still the evening of the 7th in Los Angeles.
        XCTAssertEqual(
            label(Date(timeIntervalSince1970: 1_788_836_400)),
            .init(day: "Yesterday", time: "8:00 PM")
        )
    }

    func testThePastWeeksDaysAreNamedByWeekdayAndAWeekOnByDate() {
        XCTAssertEqual(label(now - 2 * day).day, "Sunday")
        XCTAssertEqual(label(now - 6 * day).day, "Wednesday")
        XCTAssertEqual(label(now - 7 * day).day, "Tue, Sep 1")
        XCTAssertEqual(label(now - 14 * day).day, "Tue, Aug 25")
    }

    func testALineFromAnotherYearCarriesTheYear() {
        // 2025-12-31T20:15:00Z
        XCTAssertEqual(
            label(Date(timeIntervalSince1970: 1_767_212_100)),
            .init(day: "Dec 31, 2025", time: "12:15 PM")
        )
    }

    func testAStampAheadOfTheClockIsDatedRatherThanCalledToday() {
        XCTAssertEqual(label(now + 2 * day).day, "Thu, Sep 10")
    }
}
