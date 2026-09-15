import LukeKit
import SwiftUI

struct LukeWatchView: View {
    @Environment(WatchAccountSession.self) private var watchSession
    @Environment(WatchRosterStore.self) private var rosterStore
    @Environment(WatchNavigation.self) private var navigation

    var body: some View {
        Group {
            switch watchSession.state {
            case .signedOut:
                SignedOutView()
            case .signedIn:
                signedInStack
            }
        }
        .onChange(of: watchSession.accountScope) {
            // The roster and where the watch stood are the signed-in
            // developer's own: the next account starts clean, on Luke.
            rosterStore.reset()
            navigation.reset()
        }
    }

    private var signedInStack: some View {
        // The stack over Luke and the Conversation's reading are the signed-in
        // developer's own: a changed account rebuilds them from nothing.
        SignedInStack().id(watchSession.accountScope)
    }
}

/// The one stack a signed-in account stands in: the Luke screen at its root,
/// the sessions list pushed over it from the top-left button, and a session's
/// own screen over the list. The Conversation's reading is owned here, so it
/// is torn down with the stack: the next account starts with nothing of the
/// last one's thread. It polls under the device row the registrar stored, or
/// reads the messages alone before a registration lands, over the URLSession
/// the wrist waits for a path on.
private struct SignedInStack: View {
    @Environment(WatchNavigation.self) private var navigation
    @State private var conversation = ConversationStore(
        client: ConversationReadClient(
            serviceURL: AccountConstants.serviceURL, http: WatchNetwork.session
        ),
        // The store's constructor asks for the rating client the phone's
        // control writes through; the watch draws no control and never
        // calls it. Ratings are shown on the wrist and given elsewhere.
        ratingClient: MessageRatingClient(
            serviceURL: AccountConstants.serviceURL, http: WatchNetwork.session
        ),
        deviceId: { DeviceRegistrar.storedDeviceId() }
    )

    var body: some View {
        @Bindable var navigation = navigation
        return NavigationStack(path: $navigation.path) {
            WatchVoiceView()
                .navigationDestination(for: WatchRoute.self) { route in
                    switch route {
                    case .sessions:
                        WatchRosterView()
                    case .session(let session):
                        WatchSessionDetailView(session: session)
                    }
                }
        }
        .environment(conversation)
    }
}

private struct SignedOutView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "iphone")
                .font(.title2)
                .foregroundStyle(Color.accentColor)
            Text("Open Luke on your iPhone")
                .font(.caption2)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}
