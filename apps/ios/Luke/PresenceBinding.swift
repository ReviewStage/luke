import SwiftUI

extension Binding where Value == Bool {
    /// Presents an alert while an optional holds a value: true while the
    /// source is set, and setting false — the system's own dismissal — clears
    /// it. The value itself travels through the presentation's `presenting:`.
    init<Wrapped>(presence source: Binding<Wrapped?>) {
        self.init(
            get: { source.wrappedValue != nil },
            set: { if !$0 { source.wrappedValue = nil } }
        )
    }
}

extension View {
    /// The one failure alert every act surface shows: the title names the
    /// act that failed, the message is the server's own reason, and the
    /// system's dismissal clears the presented value through its presence.
    func failureAlert(_ title: String, reason: Binding<String?>) -> some View {
        alert(
            title,
            isPresented: Binding(presence: reason),
            presenting: reason.wrappedValue
        ) { _ in
            Button("OK", role: .cancel) {}
        } message: { text in
            Text(text)
        }
    }
}
