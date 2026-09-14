import Foundation

/// Transcribed from `LIVE_VOICE` in `packages/live/src/voices.ts`: every
/// voice the desktop may sync as the account's preference. The phone reads
/// one of these and speaks the `RealtimeVoice` it maps to.
public enum LiveVoice: String, CaseIterable, Sendable {
    case alloy
    case ash
    case ballad
    case beacon
    case bossa
    case cedar
    case cinder
    case coral
    case delta
    case echo
    case gleam
    case marin
    case meridian
    case quartz
    case ripple
    case sage
    case shimmer
    case stone
    case tempo
    case verse
    case vesper
    case willow

}

/// Transcribed from `REALTIME_VOICE` in
/// `packages/actions/src/remote-mint-legacy.ts`, the Live voices the Realtime
/// API the phone still mints also speaks: the picker offers these, the mint
/// refuses a voice outside them, and a synced Live voice outside them falls
/// to the default here rather than reaching the mint. The default is
/// `REALTIME_DEFAULTS.VOICE`, the same voice the desktop's Live default is.
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

    public static let `default`: RealtimeVoice = .marin

    /// The voice the phone speaks for a synced Live voice.
    public init(spoken voice: LiveVoice) {
        self = RealtimeVoice(rawValue: voice.rawValue) ?? .default
    }

    /// A stored or synced name: a Live voice the phone cannot speak falls to
    /// the default, and a name that is no voice at all is nil.
    public init?(syncedName name: String) {
        guard let live = LiveVoice(rawValue: name) else { return nil }
        self.init(spoken: live)
    }

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
