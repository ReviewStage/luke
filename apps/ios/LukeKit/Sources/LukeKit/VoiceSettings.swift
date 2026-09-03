import Foundation

/// Every voice Luke can speak with, a hand-kept transcription of
/// `REALTIME_VOICE` in `packages/realtime/src/realtime-voice-settings.ts`,
/// which stays the source of truth: the set is the Realtime API's, and the
/// mint refuses a value outside it, so a case here that drifts from the
/// TypeScript list is a control that cannot work rather than a new voice.
public enum RealtimeVoice: String, CaseIterable, Sendable, Identifiable {
    case alloy
    case ash
    case ballad
    case cedar
    case coral
    case echo
    case marin
    case sage
    case shimmer
    case verse

    /// The voice a fresh install speaks with, the desktop's default too.
    public static let `default`: RealtimeVoice = .echo

    public var id: String { rawValue }

    public var displayName: String { rawValue.capitalized }
}

/// Every pace Luke can speak at, transcribed from `REALTIME_VOICE_SPEED` in
/// the same file. Stored by name rather than by multiple so a stored value
/// reads back through this set: a number the vocabulary has not answered for
/// falls to the default rather than reaching the mint.
public enum RealtimeVoiceSpeed: String, CaseIterable, Sendable, Identifiable {
    case slow
    case normal
    case quick
    case fast

    public static let `default`: RealtimeVoiceSpeed = .normal

    public var id: String { rawValue }

    /// The multiple of the voice's natural rate the API is asked for.
    public var multiplier: Double {
        switch self {
        case .slow: 0.75
        case .normal: 1
        case .quick: 1.25
        case .fast: 1.5
        }
    }

    public var displayName: String { rawValue.capitalized }

    /// The multiple as the settings sheet words it: "1.25×".
    public var multipleLabel: String {
        "\(multiplier.formatted(.number.precision(.fractionLength(0 ... 2))))×"
    }
}

/// The UserDefaults keys the voice settings live under on this device. Both
/// the voice screen and its settings sheet read the same keys, so a change in
/// the sheet is a change the screen sees.
public enum VoiceSettingsKey {
    public static let voice = "voiceSettings.voice"
    public static let speed = "voiceSettings.speed"
}
