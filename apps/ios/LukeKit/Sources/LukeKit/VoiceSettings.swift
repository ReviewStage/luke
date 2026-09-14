import Foundation

/// Transcribed from `LIVE_VOICE` in `packages/live/src/voices.ts`: every
/// voice a GPT Live session speaks. The phone's picker offers all of them,
/// the sessions socket carries the one chosen in `session.create`, and the
/// account syncs it with the desktop. The default is `LIVE_DEFAULTS.VOICE`.
public enum LiveVoice: String, CaseIterable, Sendable, Identifiable {
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

    public static let `default`: LiveVoice = .marin

    public var id: String { rawValue }

    public var displayName: String { rawValue.capitalized }
}

/// Transcribed from `REALTIME_VOICE` in
/// `packages/actions/src/remote-mint-legacy.ts`, the Live voices the Realtime
/// API also speaks. The watch still mints a Realtime session until it moves
/// onto the hosted exchange (LUKE-224): its picker offers these, the mint
/// refuses a voice outside them, and a synced Live voice outside them reads
/// as the default from the watch's own store rather than reaching the mint.
/// The phone no longer reads this set. The default is
/// `REALTIME_DEFAULTS.VOICE`, the same voice the Live default is.
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

    public var id: String { rawValue }

    public var displayName: String { rawValue.capitalized }
}

/// Transcribed from `REALTIME_VOICE_SPEED` in the same file. The Live model
/// has no speed, so the phone dropped its slider and its sync with the move
/// onto the hosted exchange (LUKE-216); the watch keeps the pace for its own
/// Realtime mint until LUKE-224, stored under `VoiceSettingsKey.speed` on the
/// watch alone and synced nowhere. Stored by name so an unknown stored value
/// falls to the default rather than reaching the mint.
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
    /// The voice both apps read and the sync carries, a `LiveVoice` name.
    public static let voice = "voiceSettings.voice"
    /// The watch's own pace for its Realtime mint; the phone neither reads nor syncs it.
    public static let speed = "voiceSettings.speed"
}
