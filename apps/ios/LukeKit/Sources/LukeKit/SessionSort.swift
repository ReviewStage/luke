import Foundation

/// What puts a session at the top. Mirrors `SESSION_LIST_SORT` in
/// `packages/guide/src/guide.ts` and the desktop's comparators: most urgent
/// first with recency breaking ties, or last-moved first with urgency
/// breaking ties.
public enum SessionSort: CaseIterable, Hashable, Sendable {
    case urgency
    case recency
}

/// The desktop's `URGENCY_PRIORITY` read off the wire statuses: waiting and
/// error both need the developer, so both rank ahead of a session still
/// working, and a status this build does not know ranks with unknown.
private func urgencyRank(of session: RosterSession) -> Int {
    switch session.status {
    case "waiting", "error": 0
    case "working": 1
    case "complete": 2
    default: 3
    }
}

/// A session the endpoint never dated ranks as the least recently moved.
private func lastMoved(_ session: RosterSession) -> Date {
    session.lastActivityAt ?? .distantPast
}

/// The roster in the order a sort names. `sorted(by:)` is documented stable,
/// so sessions the comparator cannot tell apart keep the wire's own order.
public func sortedSessions(_ sessions: [RosterSession], by sort: SessionSort) -> [RosterSession] {
    switch sort {
    case .urgency:
        sessions.sorted {
            let (left, right) = (urgencyRank(of: $0), urgencyRank(of: $1))
            return left != right ? left < right : lastMoved($0) > lastMoved($1)
        }
    case .recency:
        sessions.sorted {
            let (left, right) = (lastMoved($0), lastMoved($1))
            return left != right ? left > right : urgencyRank(of: $0) < urgencyRank(of: $1)
        }
    }
}
