import LukeKit
import Observation

/// The two pages the signed-in watch swipes between.
enum WatchPage: Hashable {
    case voice
    case sessions
}

/// Where the watch stands: the page showing, and the session screen pushed
/// over the list. Held at app scope rather than inside the pages because an
/// open or a list asked of Luke in conversation lands on the sessions page
/// the way a row press does, and the voice page has to be able to reach it.
@MainActor
@Observable
final class WatchNavigation {
    var page: WatchPage = .voice
    var path: [RosterSession] = []

    /// Pushes a session's own screen over the list, the same press a row takes.
    func open(_ session: RosterSession) {
        path = [session]
        page = .sessions
    }

    /// Shows the list itself, with nothing pushed over it.
    func showList() {
        path.removeAll()
        page = .sessions
    }

    /// Where a fresh account starts: the voice page, with nothing pushed.
    func reset() {
        path.removeAll()
        page = .voice
    }
}
