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
        @Bindable var navigation = navigation
        return TabView(selection: $navigation.page) {
            WatchVoiceView()
                .tag(WatchPage.voice)
            NavigationStack(path: $navigation.path) {
                WatchRosterView()
            }
            .tag(WatchPage.sessions)
        }
        .tabViewStyle(.page)
        // The pages and the stack above the list are the signed-in
        // developer's own: a changed account rebuilds them from nothing.
        .id(watchSession.accountScope)
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
