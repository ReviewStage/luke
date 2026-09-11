import LukeKit
import SwiftUI

struct LukeWatchView: View {
    @Environment(WatchAccountSession.self) private var watchSession
    @Environment(WatchRosterStore.self) private var rosterStore
    @Environment(WatchNavigation.self) private var navigation
    @Environment(VoiceConversationThread.self) private var conversation

    var body: some View {
        Group {
            switch watchSession.state {
            case .signedOut:
                SignedOutView()
            case .signedIn:
                signedInPages
            }
        }
        .onChange(of: watchSession.accountScope) {
            // The roster, the conversation, and where the watch stood are
            // the signed-in developer's own: the next account starts clean.
            rosterStore.reset()
            conversation.clear()
            navigation.reset()
        }
    }

    private var signedInPages: some View {
        // The pages, the stack above the list, and the Conversation's reading
        // are the signed-in developer's own: a changed account rebuilds them
        // from nothing.
        SignedInPages().id(watchSession.accountScope)
    }
}

/// The two pages one signed-in account swipes between. The Conversation's
/// reading is owned here, so it is torn down with the pages: the next account
/// starts with nothing of the last one's thread. It polls under the device
/// row the registrar stored, or reads the messages alone before a
/// registration lands, over the URLSession the wrist waits for a path on.
private struct SignedInPages: View {
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
        // The list stands to the left of Luke, and Luke is still the page the
        // watch opens on: a swipe to the right reaches the sessions.
        return TabView(selection: $navigation.page) {
            NavigationStack(path: $navigation.path) {
                WatchRosterView()
            }
            .tag(WatchPage.sessions)
            NavigationStack {
                WatchVoiceView()
            }
            .tag(WatchPage.voice)
        }
        .tabViewStyle(.page)
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
