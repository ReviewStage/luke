import Foundation

/// Longer than a normal tap, short enough that a tap does not feel delayed.
/// This matches the desktop talk-key interaction.
public let talkButtonTapDuration: TimeInterval = 0.25

public enum TalkButtonReleaseAction: Sendable, Equatable {
    /// Leave the microphone open until the next press and release.
    case latch
    /// Commit the open microphone turn now.
    case send
}

/// A held first press sends on release. A quick first tap leaves the turn
/// open, and any release after that latched turn sends it.
public func talkButtonReleaseAction(
    heldDuration: TimeInterval,
    wasLatched: Bool
) -> TalkButtonReleaseAction {
    if wasLatched { return .send }
    return heldDuration < talkButtonTapDuration ? .latch : .send
}
