import AppKit
import Foundation

/// Turns the media players Luke knows how to speak to down while a spoken
/// exchange is happening, and back up afterwards.
///
/// Apple Events are the reason this exists, and their bounds are the feature's
/// bounds. macOS offers no way to duck every app's audio; what it offers is a
/// scripting interface per app, behind a consent dialog per app. So the players
/// are named here — Music and Spotify — and a switch upstream describes exactly
/// these two rather than "other media". Each is asked only whether it is
/// playing and how loud, and told only a volume: nothing is paused, nothing is
/// read beyond that, and an app the user never granted simply stays at its own
/// volume.
///
/// The one command language: `duck` fades every playing player down, `restore`
/// fades back whatever `duck` changed. Stdin closing is the app going away, so
/// it restores on the way out — a crash upstream must not leave the user's
/// music quiet with nothing left to bring it back.
private struct MediaPlayer {
    let bundleIdentifier: String
}

/// The players Luke may quiet. Deliberately small, like the talk key's chord
/// table: each entry is a consent dialog and a promise, not a pattern.
private let PLAYERS = [
    MediaPlayer(bundleIdentifier: "com.apple.Music"),
    MediaPlayer(bundleIdentifier: "com.spotify.client"),
]

/// Where a player's volume was, and where the duck put it. The ducked level is
/// what decides whether the original may be restored: a volume that no longer
/// reads as the ducked one was moved by the user's own hand, and their hand
/// wins. Two rememberings of that level, because Spotify quantizes a volume
/// write to its own steps and applies it a beat late — the level asked for and
/// the level read back afterwards can both be the duck's own doing, and a
/// reading near either must not be mistaken for the user's hand.
private struct DuckedPlayer {
    let player: MediaPlayer
    let original: Int
    let requested: Int
    let landed: Int
}

/// A quarter of the user's own level: audible, so a duck never reads as the
/// player having stopped, but clearly under speech.
private let DUCK_FACTOR = 0.25
/// Fading rather than stepping is what makes the duck read as polite; a small
/// number of steps is enough because each Apple Event round trip smooths it.
private let FADE_STEPS = 4
/// Down fast — Luke is about to speak — and back up more gently.
private let DUCK_STEP_SECONDS = 0.04
private let RESTORE_STEP_SECONDS = 0.08
/// Spotify reports a volume one below the one it was just set to, so "still
/// where the duck put it" has to allow the reading to sit slightly off.
private let RESTORE_TOLERANCE = 2
/// How long a player is given to apply a volume write before it is read back.
/// Spotify applies Apple Event volume writes asynchronously, and a reading
/// taken too soon answers with the level being replaced.
private let SETTLE_SECONDS = 0.15

/// Whether a reading is still the duck's own level rather than the user's
/// hand. Near either remembering counts: a player may have honored the
/// request late — after the landing was read — or never moved past where the
/// read-back caught it.
private func reads(_ reading: Int, asDucked entry: DuckedPlayer) -> Bool {
    min(abs(reading - entry.requested), abs(reading - entry.landed)) <= RESTORE_TOLERANCE
}

private let MEDIA_DUCK_COMMAND = (duck: "duck", restore: "restore")

private func emit(_ line: String) {
    guard let payload = "\(line)\n".data(using: .utf8) else { return }
    FileHandle.standardOutput.write(payload)
}

/// One Apple Event, or nothing. A player that refuses — consent denied, the
/// app quitting mid-question — is skipped rather than retried: every path here
/// runs again on the next exchange anyway. The refusal is said aloud, because
/// the commonest one is invisible otherwise: -1743 is macOS refusing on the
/// user's behalf, and it looks exactly like silence until it is printed.
private func runAppleScript(_ source: String) -> NSAppleEventDescriptor? {
    guard let script = NSAppleScript(source: source) else { return nil }
    var failure: NSDictionary?
    let result = script.executeAndReturnError(&failure)
    guard let failure else { return result }
    let number = failure[NSAppleScript.errorNumber] ?? "unknown"
    emit("refused \(number)")
    return nil
}

/// Asked of the system, not of the player: an Apple Event sent to an app that
/// is not running launches it, and starting the user's music player is the
/// opposite of quieting it.
private func isRunning(_ player: MediaPlayer) -> Bool {
    !NSRunningApplication.runningApplications(
        withBundleIdentifier: player.bundleIdentifier
    ).isEmpty
}

private func isPlaying(_ player: MediaPlayer) -> Bool {
    runAppleScript(
        "tell application id \"\(player.bundleIdentifier)\" to player state is playing"
    )?.booleanValue ?? false
}

private func volume(of player: MediaPlayer) -> Int? {
    guard let result = runAppleScript(
        "tell application id \"\(player.bundleIdentifier)\" to sound volume"
    ) else { return nil }
    return Int(result.int32Value)
}

private func setVolume(of player: MediaPlayer, to volume: Int) {
    _ = runAppleScript(
        "tell application id \"\(player.bundleIdentifier)\" to set sound volume to \(volume)"
    )
}

private func fade(_ player: MediaPlayer, from: Int, to: Int, stepSeconds: Double) {
    guard from != to else { return }
    for step in 1...FADE_STEPS {
        let value = from + (to - from) * step / FADE_STEPS
        setVolume(of: player, to: value)
        if step < FADE_STEPS { Thread.sleep(forTimeInterval: stepSeconds) }
    }
    // Integer steps can land shy of the target; the last word is exact.
    setVolume(of: player, to: to)
}

@main
@MainActor
private struct MediaDuckCommand {
    static var buffer = ""
    static var ducked: [String: DuckedPlayer] = [:]

    static func main() {
        FileHandle.standardInput.readabilityHandler = { handle in
            let data = handle.availableData
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    // Stdin closing is the app going away, deliberately or not.
                    // Restoring here is what makes a duck impossible to strand.
                    if data.isEmpty {
                        FileHandle.standardInput.readabilityHandler = nil
                        restore()
                        exit(0)
                    }
                    read(data)
                }
            }
        }
        dispatchMain()
    }

    static func read(_ data: Data) {
        buffer += String(decoding: data, as: UTF8.self)
        var lines = buffer.components(separatedBy: "\n")
        // Whatever follows the last newline is the start of a line still
        // arriving, exactly as the talk key's reader holds it.
        buffer = lines.removeLast()
        for line in lines {
            handle(line.trimmingCharacters(in: .whitespaces))
        }
    }

    static func handle(_ line: String) {
        if line == MEDIA_DUCK_COMMAND.duck { duck() }
        if line == MEDIA_DUCK_COMMAND.restore { restore() }
    }

    /// Every playing player comes down, each from its own level. A player
    /// already ducked is left alone — a repeated `duck` must not read the
    /// ducked volume back as the one to restore to.
    static func duck() {
        for player in PLAYERS where ducked[player.bundleIdentifier] == nil {
            guard isRunning(player), isPlaying(player) else { continue }
            guard let original = volume(of: player), original > 0 else { continue }
            let requested = Int((Double(original) * DUCK_FACTOR).rounded())
            fade(player, from: original, to: requested, stepSeconds: DUCK_STEP_SECONDS)
            // Only the player can say where the fade actually left it, and
            // that level is the one restore() will have to recognize.
            Thread.sleep(forTimeInterval: SETTLE_SECONDS)
            let landed = volume(of: player) ?? requested
            ducked[player.bundleIdentifier] = DuckedPlayer(
                player: player,
                original: original,
                requested: requested,
                landed: landed
            )
        }
    }

    /// Only what `duck` changed goes back, and only if it is still where the
    /// duck left it: a volume the user moved meanwhile — or a player they
    /// quit — is theirs, not this helper's to overrule. A read that merely
    /// failed is neither of those: it says nothing about the user's intent,
    /// so the memory is kept for the next restore rather than the player
    /// being stranded quiet with nothing left to bring it back. A skip is
    /// said aloud like a refusal, because honoring the user's hand and
    /// losing a restore look identical otherwise.
    static func restore() {
        let restoring = ducked
        ducked = [:]
        for (key, entry) in restoring {
            guard isRunning(entry.player) else { continue }
            guard let current = volume(of: entry.player) else {
                ducked[key] = entry
                continue
            }
            guard reads(current, asDucked: entry) else {
                emit("skipped \(key) at \(current)")
                continue
            }
            fade(entry.player, from: current, to: entry.original, stepSeconds: RESTORE_STEP_SECONDS)
        }
    }
}
