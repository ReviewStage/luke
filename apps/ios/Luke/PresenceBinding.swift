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
