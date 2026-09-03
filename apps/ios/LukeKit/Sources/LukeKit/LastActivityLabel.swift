import Foundation

/// How long ago the provider last wrote about a session, worded by the coarsest unit that has
/// begun — the same rule as the desktop panel's `lastActivityLabel` in
/// `packages/panel/src/layout.ts`, so a session reads the same age on both
/// surfaces. Single-letter units with no "ago", the way Mail and Messages
/// abbreviate, and a timestamp ahead of this device's clock reads "Now",
/// because clock skew between machines is not news about the session.
public func lastActivityLabel(lastActivityAt: Date, now: Date) -> String {
    let elapsedMinutes = Int(floor(now.timeIntervalSince(lastActivityAt) / 60))
    if elapsedMinutes < 1 { return "Now" }
    if elapsedMinutes < 60 { return "\(elapsedMinutes)m" }
    let elapsedHours = elapsedMinutes / 60
    if elapsedHours < 24 { return "\(elapsedHours)h" }
    return "\(elapsedHours / 24)d"
}
