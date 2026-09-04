import SwiftUI

@main
struct LukeWatchApp: App {
    @State private var watchSession: WatchAccountSession
    @State private var rosterStore: WatchRosterStore
    // Held for its lifetime — the delegate must not be deallocated.
    private let connectivity: WatchConnectivityReceiver

    init() {
        let watchSession = WatchAccountSession()
        _watchSession = State(initialValue: watchSession)
        connectivity = WatchConnectivityReceiver(watchSession: watchSession)
        _rosterStore = State(initialValue: WatchRosterStore(session: watchSession))
    }

    var body: some Scene {
        WindowGroup {
            LukeWatchView()
                .environment(watchSession)
                .environment(rosterStore)
        }
    }
}
