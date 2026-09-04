import SwiftUI

struct LukeWatchView: View {
    @Environment(WatchAccountSession.self) private var watchSession
    @Environment(WatchRosterStore.self) private var rosterStore
    @State private var selectedTab = 0

    var body: some View {
        Group {
            switch watchSession.state {
            case .signedOut:
                SignedOutView()
            case .signedIn:
                TabView(selection: $selectedTab) {
                    WatchVoiceView()
                        .tag(0)
                    NavigationStack {
                        WatchRosterView()
                    }
                    .tag(1)
                }
                .tabViewStyle(.page)
                .id(watchSession.accountScope)
            }
        }
        .onChange(of: watchSession.accountScope) {
            rosterStore.reset()
        }
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
