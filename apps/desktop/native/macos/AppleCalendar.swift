import AppKit
import EventKit
import Foundation

/// Reads when the meetings in this Mac's own Calendar start and end, and
/// nothing else leaves this process.
///
/// EventKit is the reason this is a helper and the bound on what crosses the
/// pipe. macOS publishes no free/busy read: the only way to learn whether a
/// meeting covers now is full calendar access, which hands over whole events —
/// titles, attendees, notes. So the narrowing happens here, before anything
/// reaches the app: an event is read for its start and end instants alone, and
/// every other field dies with this process. The calendar list travels too —
/// ids, names, and colours are what the settings rows draw and the user
/// chooses from — exactly what the Google reader's list read carries.
///
/// The helper is its own consent identity, on purpose. macOS attributes a
/// process's TCC asks to its "responsible process" — for anything launched
/// out of a terminal that is the terminal, or the app that held it, whose
/// bundle says nothing about calendars, so the ask is refused without a
/// dialog ever existing. So the helper re-execs itself disclaimed (the same
/// mechanism Chromium's and Firefox's helpers use) and becomes its own
/// responsible process: the dialog is asked against the helper's own minimal
/// bundle — whose Info.plist names it Luke — the grant lands on that
/// identity, and both stand whether Luke was launched from the Finder, a
/// terminal, or another app, in development or packaged. Reads never prompt:
/// every command checks
/// the authorization first and answers with the status alone when the access
/// is anything short of full.
///
/// Three commands, fixed here — every one a process that answers and exits,
/// on purpose: EventKit answers a running process's authorization from state
/// it read at launch, so only a fresh process can be trusted about where the
/// consent switch stands now. `status` reports the authorization,
/// `request-access` asks the system — the one command that may raise the
/// dialog — and reports what the connect flow seeds from, and
/// `observe <start> <end> [calendar-id…]` reports the calendar list and the
/// busy intervals of the named calendars inside the window. The observe ids
/// are intersected with the list the same read produced, so an argument can
/// steer the read only among calendars the Mac actually has. One JSON
/// document on stdout is the whole answer.
private let APPLE_CALENDAR_COMMAND = (
    status: "status", requestAccess: "request-access", observe: "observe"
)

/// The re-exec's marker, so the disclaimed child answers the command instead
/// of disclaiming again. Never a command of its own.
private let DISCLAIMED_MARKER = "--disclaimed"

/// The disclaimed child the wrapper is waiting out, global because a signal
/// handler may capture nothing and must still find it.
private var disclaimedChild: pid_t = 0

/// The one private call in this repository, declared rather than imported
/// because Apple ships no header for it: it marks a spawn attribute so the
/// child becomes its own TCC responsible process instead of inheriting the
/// spawner's chain. Chromium and Firefox ship on it for exactly this, and
/// notarization accepts it; without it, a helper's consent ask is judged
/// against whatever app happens to stand at the top of the launch chain.
@_silgen_name("responsibility_spawnattrs_setdisclaim")
private func responsibility_spawnattrs_setdisclaim(
    _ attributes: UnsafeMutablePointer<posix_spawnattr_t?>,
    _ disclaim: Int32
) -> Int32

/// Enough events to cover the window's meetings many times over; the app
/// bounds the meetings it keeps far below this either way.
private let MAXIMUM_REPORTED_EVENTS = 500

private struct ReportedCalendar: Encodable {
    let id: String
    let label: String
    let color: String?
    /// The source the calendar belongs to — iCloud, a Google account,
    /// Subscribed — the way Calendar.app sections its own sidebar, so the
    /// settings rows can section theirs.
    let group: String?
}

private struct ReportedInterval: Encodable {
    let start: String
    let end: String
}

private struct Report: Encodable {
    let access: String
    var calendars: [ReportedCalendar]?
    var defaultCalendarId: String?
    var busy: [ReportedInterval]?
    /// Why the consent ask itself failed, when it did — different news from
    /// the user saying no, and invisible without this line.
    var failure: String?
}

private func accessWord(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .fullAccess: return "full-access"
    case .writeOnly: return "write-only"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not-determined"
    @unknown default: return "denied"
    }
}

private func emit(_ report: Report) {
    guard let payload = try? JSONEncoder().encode(report) else { exit(1) }
    FileHandle.standardOutput.write(payload)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

/// The calendar's own colour as one style value, or nothing: a colour is the
/// one listed field that becomes a style, so anything unconvertible is
/// dropped rather than passed along.
private func hexColor(_ color: NSColor?) -> String? {
    guard let srgb = color?.usingColorSpace(.sRGB) else { return nil }
    let red = Int((srgb.redComponent * 255).rounded())
    let green = Int((srgb.greenComponent * 255).rounded())
    let blue = Int((srgb.blueComponent * 255).rounded())
    return String(format: "#%02x%02x%02x", red, green, blue)
}

private func reportedCalendars(_ calendars: [EKCalendar]) -> [ReportedCalendar] {
    calendars.map { calendar in
        ReportedCalendar(
            id: calendar.calendarIdentifier,
            label: calendar.title,
            color: hexColor(calendar.color),
            group: calendar.source?.title
        )
    }
}

/// A fresh store in a short-lived process may not have every source loaded
/// yet — iCloud and account calendars arrive behind the local ones — and a
/// list read too early would miss whole accounts. Asking for the refresh
/// before the first read is what makes the list whole.
private func freshEventStore() -> EKEventStore {
    let store = EKEventStore()
    store.refreshSourcesIfNecessary()
    return store
}

/// An instant as the app sends it — RFC 3339, with or without fractional
/// seconds, because `Date.toISOString` writes the fraction and a hand-run
/// invocation will not.
private func parseInstant(_ text: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: text) { return date }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: text)
}

/// What the helper's own bundle carries, for a suppressed ask: the helper
/// answers for itself, so its own Info.plist is the one the suppression was
/// judged against, and the report says what stands there rather than
/// guessing.
private func suppressedDiagnosis() -> String {
    let bundle = Bundle.main
    let fullAccess = bundle.object(forInfoDictionaryKey: "NSCalendarsFullAccessUsageDescription")
    let legacy = bundle.object(forInfoDictionaryKey: "NSCalendarsUsageDescription")
    return "macOS suppressed the consent dialog for the helper's own identity — its bundle's "
        + "usage descriptions are \(fullAccess == nil ? "missing" : "present") (full access) and "
        + "\(legacy == nil ? "missing" : "present") (legacy)"
}

/// Whether the user's own reply to the invitation was no. A meeting declined
/// still sits on the calendar, but it is not one the user is in, and Google's
/// free/busy answers the same way.
private func declinedByUser(_ event: EKEvent) -> Bool {
    guard let attendees = event.attendees else { return false }
    return attendees.contains { $0.isCurrentUser && $0.participantStatus == .declined }
}

/// The busy intervals of the chosen calendars: each event's start and end and
/// nothing else. All-day entries, events marked free, and cancelled events
/// are not meetings — a birthday must not silence an afternoon, and neither
/// may a meeting that is not happening — and one the user declined is not
/// theirs.
private func busyIntervals(
    _ store: EKEventStore, from start: Date, to end: Date, calendars: [EKCalendar]
) -> [ReportedInterval] {
    guard !calendars.isEmpty else { return [] }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    var intervals: [ReportedInterval] = []
    for event in store.events(matching: predicate) {
        if intervals.count >= MAXIMUM_REPORTED_EVENTS { break }
        if event.isAllDay || event.availability == .free || event.status == .canceled
            || declinedByUser(event) {
            continue
        }
        guard let startDate = event.startDate, let endDate = event.endDate else { continue }
        intervals.append(
            ReportedInterval(
                start: formatter.string(from: startDate),
                end: formatter.string(from: endDate)
            )
        )
    }
    return intervals
}

@main
private struct AppleCalendarCommand {
    static func main() {
        var arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.first == DISCLAIMED_MARKER else {
            exit(respawnDisclaimed(arguments))
        }
        arguments.removeFirst()
        guard let command = arguments.first else { exit(2) }
        switch command {
        case APPLE_CALENDAR_COMMAND.status:
            emit(Report(access: accessWord(EKEventStore.authorizationStatus(for: .event))))
        case APPLE_CALENDAR_COMMAND.requestAccess:
            // The consent machinery answers over the process's main queue, so
            // the ask runs as a task over a live dispatch main — the shape
            // every long-lived helper here keeps — and exits once answered.
            Task {
                await requestAccess()
                exit(0)
            }
            dispatchMain()
        case APPLE_CALENDAR_COMMAND.observe:
            observe(Array(arguments.dropFirst()))
        default:
            exit(2)
        }
    }

    /// Runs this same binary and command once more, disclaimed, and stands
    /// aside: the child inherits stdout, so its one JSON document is the
    /// answer, and its exit status is this one's. A system too old or too new
    /// to disclaim just runs the child under the inherited chain — the ask
    /// then answers as suppressed rather than the helper refusing to exist.
    static func respawnDisclaimed(_ arguments: [String]) -> Int32 {
        var buffer = [CChar](repeating: 0, count: 4 * 1024)
        guard proc_pidpath(getpid(), &buffer, UInt32(buffer.count)) > 0 else { return 1 }
        let path = String(cString: buffer)
        var attributes: posix_spawnattr_t?
        guard posix_spawnattr_init(&attributes) == 0 else { return 1 }
        defer { posix_spawnattr_destroy(&attributes) }
        _ = responsibility_spawnattrs_setdisclaim(&attributes, 1)
        var argv = ([path, DISCLAIMED_MARKER] + arguments).map { strdup($0) }
        argv.append(nil)
        defer { for argument in argv { free(argument) } }
        var pid: pid_t = 0
        guard posix_spawn(&pid, path, nil, &attributes, argv, environ) == 0 else { return 1 }
        disclaimedChild = pid
        // A timeout upstream signals this wrapper alone, so the wrapper walks
        // its child out with it: an EventKit process — its consent dialog
        // included — must not outlive the call that owns it.
        for terminal in [SIGTERM, SIGINT, SIGHUP] {
            signal(terminal) { _ in
                if disclaimedChild > 0 { kill(disclaimedChild, SIGTERM) }
                _exit(1)
            }
        }
        var status: Int32 = 0
        guard waitpid(pid, &status, 0) == pid else { return 1 }
        // WIFEXITED/WEXITSTATUS by hand; the macros do not reach Swift.
        return (status & 0x7f) == 0 ? (status >> 8) & 0xff : 1
    }

    /// Asks the system for full calendar access — the one command that may
    /// raise the consent dialog — and, once granted, answers with what the
    /// connect flow seeds the settings from: the calendar list and the
    /// calendar new events land on, the nearest thing this Mac has to
    /// Google's primary.
    static func requestAccess() async {
        let store = freshEventStore()
        do {
            guard try await store.requestFullAccessToEvents() else {
                let status = EKEventStore.authorizationStatus(for: .event)
                // A no that left the status untouched means macOS suppressed
                // the dialog rather than showed it — indistinguishable from
                // the user pressing Deny unless it is said, and judged
                // against this binary's own embedded Info.plist now that the
                // helper answers for itself.
                emit(
                    Report(
                        access: accessWord(status),
                        failure: status == .notDetermined ? suppressedDiagnosis() : nil
                    )
                )
                return
            }
        } catch {
            emit(
                Report(
                    access: accessWord(EKEventStore.authorizationStatus(for: .event)),
                    failure: error.localizedDescription
                )
            )
            return
        }
        emit(
            Report(
                access: accessWord(.fullAccess),
                calendars: reportedCalendars(store.calendars(for: .event)),
                defaultCalendarId: store.defaultCalendarForNewEvents?.calendarIdentifier
            )
        )
    }

    /// One read: the calendar list, and the busy intervals of the asked-for
    /// calendars inside the asked-for window. Never prompts — anything short
    /// of full access answers with the status alone, and the app treats that
    /// as a calendar that cannot answer rather than an empty diary.
    static func observe(_ arguments: [String]) {
        let status = EKEventStore.authorizationStatus(for: .event)
        guard status == .fullAccess else {
            emit(Report(access: accessWord(status)))
            return
        }
        guard arguments.count >= 2,
            let start = parseInstant(arguments[0]),
            let end = parseInstant(arguments[1]),
            start < end
        else { exit(2) }
        let store = freshEventStore()
        let calendars = store.calendars(for: .event)
        let selected = Set(arguments.dropFirst(2))
        emit(
            Report(
                access: accessWord(.fullAccess),
                calendars: reportedCalendars(calendars),
                busy: busyIntervals(
                    store,
                    from: start,
                    to: end,
                    calendars: calendars.filter { selected.contains($0.calendarIdentifier) }
                )
            )
        )
    }
}
