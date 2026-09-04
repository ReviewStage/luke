import AVFoundation

/// The audio session behind one voice call, held active for the call's life.
///
/// watchOS lets every app speak HTTP through URLSession, but counts a
/// WebSocket as low-level networking and grants it only to an audio streaming
/// app while its audio session is active (TN3135; WWDC 2019 session 716).
/// The watch app declares the audio background mode for that reason, and
/// this is the other half: the session goes active before the Realtime
/// socket opens and stays active until the call closes. A capturer or player
/// that deactivated it between turns would cut the socket under the call.
enum WatchVoiceAudioSession {
    static func activate() throws {
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .default)
        try audioSession.setActive(true)
    }

    static func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
