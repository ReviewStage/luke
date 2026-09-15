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

public enum VoiceSettingsKey {
    /// The voice both apps read and the sync carries, a `LiveVoice` name.
    public static let voice = "voiceSettings.voice"
}
