import SwiftUI
import LukeKit

struct LukeWatchView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(.accent)
            Text("Luke")
                .font(.headline)
        }
    }
}
