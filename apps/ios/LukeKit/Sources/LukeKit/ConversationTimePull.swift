import Foundation

/// The sideways pull that uncovers the thread's timestamps, the way iMessage
/// does: the stamps stand in a column past the screen's trailing edge, and a
/// drag to the left brings the column in by exactly the distance dragged
/// until the column stands fully in view, past which the drag meets
/// resistance and gives only a little more, so the fingers feel where the
/// column ends. A drag to the right pulls nothing. The arithmetic lives here,
/// off the screen, so the phone and the watch pull the same way and a test
/// can say so.
public enum ConversationTimePull {
    /// How much of a drag past the column's full reveal still moves it.
    public static let overshootFraction = 0.2

    /// Whether a drag is the pull's rather than the scroll's, read from its
    /// first movement: mostly sideways is a pull, mostly upright a scroll.
    public static func claimsDrag(width: Double, height: Double) -> Bool {
        abs(width) > abs(height)
    }

    /// How far the column stands in for a drag whose horizontal translation
    /// is `translation` (negative to the left, as the system reports it),
    /// given the distance `reveal` at which it stands fully in view.
    public static func distance(dragged translation: Double, reveal: Double) -> Double {
        let pulled = -translation
        guard pulled > 0 else { return 0 }
        guard pulled > reveal else { return pulled }
        return reveal + (pulled - reveal) * overshootFraction
    }
}
