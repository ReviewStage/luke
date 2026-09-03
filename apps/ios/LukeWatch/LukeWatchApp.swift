import LukeKit
import SwiftUI

@main
struct LukeWatchApp: App {
    @State private var watchSession: WatchAccountSession
    // Held for its lifetime — the delegate must not be deallocated.
    private let connectivity: WatchConnectivityReceiver

    init() {
        let watchSession = WatchAccountSession(
            client: AccountClient(
                baseURL: AccountConstants.baseURL,
                clientID: AccountConstants.clientID
            )
        )
        _watchSession = State(initialValue: watchSession)
        connectivity = WatchConnectivityReceiver(watchSession: watchSession)
    }

    var body: some Scene {
        WindowGroup {
            LukeWatchView()
                .environment(watchSession)
        }
    }
}
