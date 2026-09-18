import LukeKit
import Observation

/// What the watch pushes over Luke: the sessions list, and one session's own
/// screen over the list. The Luke screen is the root and is never a route.
enum WatchRoute: Hashable {
    case sessions
    case session(RosterSession)
}

/// Where the watch stands: the stack pushed over the Luke screen. Held at app
/// scope rather than inside the stack because a session named in the
/// Conversation opens its screen the way a row press does, and the Luke
/// screen has to be able to reach it.
@MainActor
@Observable
final class WatchNavigation {
    var path: [WatchRoute] = []

    /// Pushes the sessions list over Luke, the press the top-right button takes.
    func showSessions() {
        path = [.sessions]
    }

    /// Pushes a session's own screen over the list, so the back button returns
    /// to the sessions and then to Luke, the same as a row press would leave it.
    func open(_ session: RosterSession) {
        path = [.sessions, .session(session)]
    }

    /// Where a fresh account starts: the Luke screen, with nothing pushed.
    func reset() {
        path.removeAll()
    }
}
