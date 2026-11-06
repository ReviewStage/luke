export const MICROPHONE_STATUS = {
  NOT_DETERMINED: "not-determined",
  GRANTED: "granted",
  DENIED: "denied",
  RESTRICTED: "restricted",
  UNKNOWN: "unknown",
} as const;

export type MicrophoneStatus = (typeof MICROPHONE_STATUS)[keyof typeof MICROPHONE_STATUS];

export const MICROPHONE_TRANSPORT = {
  BUILT_IN: "built-in",
  BLUETOOTH: "bluetooth",
  OTHER: "other",
  NONE: "none",
} as const;

export type MicrophoneTransport = (typeof MICROPHONE_TRANSPORT)[keyof typeof MICROPHONE_TRANSPORT];

export const LID_STATE = {
  OPEN: "open",
  SHUT: "shut",
  UNKNOWN: "unknown",
} as const;

export type LidState = (typeof LID_STATE)[keyof typeof LID_STATE];

export interface MicrophoneRoute {
  defaultTransport: MicrophoneTransport;
  lid: LidState;
  builtInName?: string;
}
