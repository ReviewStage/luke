import SwiftUI

struct LukeWatchView: View {
    @Environment(WatchAccountSession.self) private var watchSession

    var body: some View {
        switch watchSession.state {
        case .signedOut:
            SignedOutView()
        case .signedIn:
            NavigationStack {
                WatchRosterView()
            }
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
