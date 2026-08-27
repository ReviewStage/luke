import SwiftUI

struct ContentView: View {
  var body: some View {
    VStack(spacing: 12) {
      Text("Hello, Luke")
        .font(.largeTitle.bold())
      Text("iOS companion")
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
    .padding()
  }
}
