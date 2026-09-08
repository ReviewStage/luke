/**
 * How far macOS's own microphone permission stands, in the media-access
 * statuses Electron documents. Only `NOT_DETERMINED` is a state the panel may
 * still ask from; `UNKNOWN` is the answer when the permission could not be
 * read at all, which is neither a grant nor a refusal and is said as such.
 */
export const MICROPHONE_STATUS = {
  NOT_DETERMINED: "not-determined",
  GRANTED: "granted",
  DENIED: "denied",
  RESTRICTED: "restricted",
  UNKNOWN: "unknown",
} as const;

export type MicrophoneStatus = (typeof MICROPHONE_STATUS)[keyof typeof MICROPHONE_STATUS];

/**
 * Whether the Mac's output would let Luke be heard: the default output
 * device's mute switch and its volume, read by a helper that reads nothing
 * else. Absent wherever it cannot be read — another platform, no output
 * device, a device with no controls — and absence must always be taken as
 * audible: the hint this feeds exists to explain silence, never to guess it.
 */
export interface OutputAudioState {
  muted: boolean;
  /** The output volume as macOS reports it, 0–1. */
  volume: number;
}

/** How the default input device reaches the Mac, as CoreAudio classifies it. */
export const MICROPHONE_TRANSPORT = {
  BUILT_IN: "built-in",
  BLUETOOTH: "bluetooth",
  OTHER: "other",
  /** No input device at all. */
  NONE: "none",
} as const;

export type MicrophoneTransport = (typeof MICROPHONE_TRANSPORT)[keyof typeof MICROPHONE_TRANSPORT];

/** The lid over the built-in microphone. A desktop keeps no lid: `unknown`. */
export const LID_STATE = {
  OPEN: "open",
  SHUT: "shut",
  UNKNOWN: "unknown",
} as const;

export type LidState = (typeof LID_STATE)[keyof typeof LID_STATE];

/**
 * Where the developer's voice would be captured from: the default input's
 * transport, the built-in microphone's name when the machine has one, and
 * whether the lid over it is open. Read by a helper that reads nothing else
 * and can write nothing. What it decides is bounded to one action — which device
 * the renderer asks the browser to open when a press takes a turn, so a
 * Bluetooth headset keeps its music codec while the Mac's own microphone
 * listens, and is listened to itself when a shut lid would muffle the Mac's.
 * Absent wherever it cannot be read, and absence means the browser's default.
 */
export interface MicrophoneRoute {
  defaultTransport: MicrophoneTransport;
  lid: LidState;
  builtInName?: string;
}

/** The talk key as the panel should describe it, as an accelerator. */
export interface VoiceHotkeyState {
  hotkey?: string;
  held: boolean;
}
