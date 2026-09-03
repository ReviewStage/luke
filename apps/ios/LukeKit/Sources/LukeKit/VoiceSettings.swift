import Foundation

/// Transcribed from `REALTIME_VOICE` in
/// `packages/realtime/src/realtime-voice-settings.ts`, which stays the source
/// of truth: the mint refuses a voice outside it.
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

    public static let `default`: RealtimeVoice = .echo

    public var id: String { rawValue }

    public var displayName: String { rawValue.capitalized }
}

/// Transcribed from `REALTIME_VOICE_SPEED` in the same file. Stored by name so
/// an unknown stored value falls to the default rather than reaching the mint.
public enum RealtimeVoiceSpeed: String, CaseIterable, Sendable, Identifiable {
    case slow
    case normal
    case quick
    case fast

    public static let `default`: RealtimeVoiceSpeed = .normal

    public var id: String { rawValue }

    public var multiplier: Double {
        switch self {
        case .slow: 0.75
        case .normal: 1
        case .quick: 1.25
        case .fast: 1.5
        }
    }

    /// A slider over this range at this step lands only on the cases above.
    public static let multiplierRange: ClosedRange<Double> = 0.75 ... 1.5
    public static let multiplierStep: Double = 0.25

    public init?(multiplier: Double) {
        guard let match = Self.allCases.first(where: { abs($0.multiplier - multiplier) < 0.001 })
        else { return nil }
        self = match
    }

    public var displayName: String { rawValue.capitalized }

    public var multipleLabel: String {
        "\(multiplier.formatted(.number.precision(.fractionLength(0 ... 2))))×"
    }
}

public enum VoiceSettingsKey {
    public static let voice = "voiceSettings.voice"
    public static let speed = "voiceSettings.speed"
}
