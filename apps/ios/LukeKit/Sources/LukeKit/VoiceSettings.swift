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

    /// The span a slider over the steps covers, and the step between them:
    /// with these bounds a slider lands on exactly the four multiples above
    /// and on nothing between, so a drag can never ask for a pace the mint
    /// would refuse.
    public static let multiplierRange: ClosedRange<Double> = 0.75 ... 1.5
    public static let multiplierStep: Double = 0.25

    /// The step a slider's value names, or nil for a value off the steps.
    public init?(multiplier: Double) {
        guard let match = Self.allCases.first(where: { abs($0.multiplier - multiplier) < 0.001 })
        else { return nil }
        self = match
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
