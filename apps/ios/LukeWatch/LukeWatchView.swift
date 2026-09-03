import SwiftUI

struct LukeWatchView: View {
    @Environment(WatchAccountSession.self) private var watchSession

    var body: some View {
        switch watchSession.state {
        case .signedOut:
            SignedOutView()
        case .signedIn:
            SignedInPlaceholderView()
        }
    }
}

private struct SignedOutView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "iphone")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Color.accentColor)
            Text("Open Luke on your iPhone")
                .font(.caption2)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

private struct SignedInPlaceholderView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(Color.accentColor)
            Text("Luke")
                .font(.headline)
        }
    }
}
