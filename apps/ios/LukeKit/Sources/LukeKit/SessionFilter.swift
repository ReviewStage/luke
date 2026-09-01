import Foundation

/// One narrowing the sessions list can hold: a provider whose sessions to
/// keep, or a status. The values are identities a row already carries, read
/// straight off the observed roster rather than from a fixed set, because the
/// wire's provider ids and statuses are open vocabularies this app does not
/// own. Mirrors `SessionFilter` in `packages/session/src/session-filter.ts`,
/// narrowed to the two axes the roster's wire shape actually distinguishes.
public enum SessionFilter: Hashable, Sendable {
    case provider(String)
    case status(String)

    public var axis: SessionFilterAxis {
        switch self {
        case .provider: .provider
        case .status: .status
        }
    }

    /// The observed value this filter keeps: a session answers it when the
    /// field its axis reads carries this string.
    public var value: String {
        switch self {
        case .provider(let providerId): providerId
        case .status(let status): status
        }
    }
}

/// The independent questions the filters answer. Each filter value belongs to
/// exactly one axis, and the axis is what gives a combined selection its
/// meaning: values on one axis are alternatives, where values on different
/// axes are each a further narrowing.
public enum SessionFilterAxis: CaseIterable, Hashable, Sendable {
    case provider
    case status

    fileprivate func filter(_ value: String) -> SessionFilter {
        switch self {
        case .provider: .provider(value)
        case .status: .status(value)
        }
    }
}

extension RosterSession {
    fileprivate func filterValue(on axis: SessionFilterAxis) -> String {
        switch axis {
        case .provider: providerId
        case .status: status
        }
    }
}

/// Whether a session answers the whole selection. Within one axis the values
/// are ORed — two providers together is either provider — and across axes
/// they are ANDed — a provider beside a status is that provider's sessions in
/// that status. An axis nothing is chosen on asks nothing, so an empty
/// selection is the unnarrowed list. Mirrors `matchesFilterSelection` in
/// `packages/session/src/session-filter.ts`.
public func matchesFilterSelection(
    _ selection: Set<SessionFilter>,
    session: RosterSession
) -> Bool {
    for axis in SessionFilterAxis.allCases {
        let alternatives = selection.filter { $0.axis == axis }
        if alternatives.isEmpty { continue }
        let observed = session.filterValue(on: axis)
        if !alternatives.contains(where: { $0.value == observed }) { return false }
    }
    return true
}

/// One offerable filter beside how many observed sessions carry its value.
public struct SessionFilterOption: Hashable, Sendable, Identifiable {
    public let filter: SessionFilter
    public let count: Int

    public var id: SessionFilter { filter }

    public init(filter: SessionFilter, count: Int) {
        self.filter = filter
        self.count = count
    }
}

/// One axis's options, in the order the menu draws them.
public struct SessionFilterAxisOptions: Hashable, Sendable, Identifiable {
    public let axis: SessionFilterAxis
    public let options: [SessionFilterOption]

    public var id: SessionFilterAxis { axis }

    public init(axis: SessionFilterAxis, options: [SessionFilterOption]) {
        self.axis = axis
        self.options = options
    }
}

/// The filter menu's contents for an observed roster. An axis is offered only
/// while it is a real choice — more than one distinct value among the
/// observed sessions — because a filter every session answers narrows
/// nothing. On an offered axis, a selected value the roster no longer shows
/// stays listed at zero, so a checkmark that still narrows the list can
/// always be lifted where it was set. Options sort by value, not count, so a
/// refresh cannot reorder the menu under an open press.
public func sessionFilterOptions(
    sessions: [RosterSession],
    selection: Set<SessionFilter>
) -> [SessionFilterAxisOptions] {
    SessionFilterAxis.allCases.compactMap { axis in
        var counts: [String: Int] = [:]
        for session in sessions {
            counts[session.filterValue(on: axis), default: 0] += 1
        }
        guard counts.count > 1 else { return nil }
        for filter in selection where filter.axis == axis {
            if counts[filter.value] == nil { counts[filter.value] = 0 }
        }
        let options = counts
            .sorted { $0.key < $1.key }
            .map { SessionFilterOption(filter: axis.filter($0.key), count: $0.value) }
        return SessionFilterAxisOptions(axis: axis, options: options)
    }
}
