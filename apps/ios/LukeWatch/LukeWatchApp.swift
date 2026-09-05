import LukeKit
import SwiftUI

@main
struct LukeWatchApp: App {
    @State private var watchSession: WatchAccountSession
    @State private var rosterStore: WatchRosterStore
    @State private var events: ProductEventSender
    @State private var navigation = WatchNavigation()
    @State private var conversation = VoiceConversationThread()
    @Environment(\.scenePhase) private var scenePhase
    // Held for its lifetime — the delegate must not be deallocated.
    private let connectivity: WatchConnectivityReceiver

    init() {
        let watchSession = WatchAccountSession()
        _watchSession = State(initialValue: watchSession)
        connectivity = WatchConnectivityReceiver(watchSession: watchSession)
        let events = ProductEventSender(
            serviceURL: AccountConstants.serviceURL,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0",
            client: .watchOS,
            sends: true,
            session: WatchCountingTokens(session: watchSession)
        )
        _events = State(initialValue: events)
        _rosterStore = State(initialValue: WatchRosterStore(session: watchSession, events: events))
        // Account edges are not counted here: a sign-in on the watch is the
        // phone's relay, and the phone already counted it.
        events.arm()
        events.record(.appLaunch)
        events.markDayActive()
        events.start()
    }

    var body: some Scene {
        WindowGroup {
            LukeWatchView()
                .environment(watchSession)
                .environment(rosterStore)
                .environment(events)
                .environment(navigation)
                .environment(conversation)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { events.flush() }
        }
    }
}
