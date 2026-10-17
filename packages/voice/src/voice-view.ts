import {
  LIVE_STATUS,
  type LiveStatus,
  TRANSCRIPT_SPEAKER,
  type TranscriptSpeaker,
} from "@luke/live";
import {
  isOptionalWireString,
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@luke/wire";

/**
 * What a panel needs to draw the live conversation and cannot derive or read
 * elsewhere. The voice window reports the whole snapshot on every edge and the
 * main process forwards it unchanged to every panel, so each display draws the
 * same voice state at the same instant and holds nothing it cannot lose.
 */
export interface VoiceSpeakers {
  /** Whether the developer's microphone is being heard. */
  listening: boolean;
  /** Whether Luke is audible on the remote track. */
  lukeSpeaking: boolean;
}

/** One line said on the standing call, as the voice window's captions group it, with its span in milliseconds into the call. */
interface VoiceCallLine {
  readonly rowId: string;
  readonly speaker: TranscriptSpeaker;
  readonly words: string;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Everything said on the standing call so far: the store's id for its
 * session, which the task's stored transcript names the call by once it
 * ends, and its lines in the order they opened.
 */
interface VoiceCallTranscript {
  readonly voiceSessionId: string | undefined;
  readonly lines: readonly VoiceCallLine[];
}

export interface VoiceView extends VoiceSpeakers {
  /**
   * The one claim the status names, which the media duck, the exchange count,
   * and the captions read; who is actually being heard is the two flags
   * above, since a full-duplex session can carry both at once.
   */
  voiceStatus: LiveStatus;
  voiceError: string | undefined;
  voiceNotice: string | undefined;
  talkOpening: boolean;
  lukeCaptions: readonly string[] | undefined;
  /** The developer's own words still being said, drawn only under the captions preference. */
  developerCaptions: readonly string[] | undefined;
  /** The task the standing call is about, where the panel's open task opened it; none for no call. */
  callTaskId: string | undefined;
  /** What was said on the standing call so far, whatever the captions preference; none for no call or before its first line. */
  callTranscript: VoiceCallTranscript | undefined;
  /** The store's id for the session of the last call Luke ended himself; none before he has. */
  lukeEndedCall: string | undefined;
  /** Whether Luke's voice is silenced on this Mac for the standing call, his words still captioned; never while none stands. */
  speakerMuted: boolean;
}

/**
 * The asks a panel forwards to the main process for the voice window to carry
 * out. No press decides anything in the panel: the talk key never travels this
 * way, because the main process routes it to the voice window directly.
 */
export const VOICE_COMMAND = {
  STOP_SPEAKING: "stop-speaking",
  END_CALL: "end-call",
  /** The standing call's microphone muted, or heard again, whatever task the panel has open. */
  TOGGLE_MICROPHONE: "toggle-microphone",
  /** Luke's voice silenced on this Mac for the call standing, and heard again; the session is told nothing. */
  MUTE_SPEAKER: "mute-speaker",
  UNMUTE_SPEAKER: "unmute-speaker",
  REQUEST_MICROPHONE_ACCESS: "request-microphone-access",
} as const;

export type VoiceCommand = (typeof VOICE_COMMAND)[keyof typeof VOICE_COMMAND];

/**
 * The voice at rest: what a panel draws before the voice window has reported
 * anything, and what the main process tells every panel when the voice
 * renderer dies, so no display keeps drawing an exchange that is gone.
 */
export const IDLE_VOICE_VIEW: VoiceView = {
  voiceStatus: LIVE_STATUS.IDLE,
  listening: false,
  lukeSpeaking: false,
  voiceError: undefined,
  voiceNotice: undefined,
  talkOpening: false,
  lukeCaptions: undefined,
  developerCaptions: undefined,
  callTaskId: undefined,
  callTranscript: undefined,
  lukeEndedCall: undefined,
  speakerMuted: false,
};

/** The statuses of a call still in progress, the ones a task call holds the panel open through. */
const CALL_IN_PROGRESS: ReadonlySet<LiveStatus> = new Set([
  LIVE_STATUS.CONNECTING,
  LIVE_STATUS.MUTED,
  LIVE_STATUS.LISTENING,
  LIVE_STATUS.SPEAKING,
]);

/**
 * Whether a task call is in progress: the developer is talking a task
 * through, whatever the panel shows. A call closing or failed is not in
 * progress. The panel's call bar, the mute chords, and the floating call
 * window all answer to it.
 */
export function callInProgress(view: Pick<VoiceView, "voiceStatus" | "callTaskId">): boolean {
  return view.callTaskId !== undefined && CALL_IN_PROGRESS.has(view.voiceStatus);
}

const LIVE_STATUSES: ReadonlySet<string> = new Set(Object.values(LIVE_STATUS));

function isLiveStatus(value: UnparsedWireValue): value is LiveStatus {
  return isWireString(value) && LIVE_STATUSES.has(value);
}

const VOICE_COMMANDS: ReadonlySet<string> = new Set(Object.values(VOICE_COMMAND));

export function isVoiceCommand(value: UnparsedWireValue): value is VoiceCommand {
  return isWireString(value) && VOICE_COMMANDS.has(value);
}

function isOptionalWireStrings(value: UnparsedWireValue): value is readonly string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isWireString));
}

const TRANSCRIPT_SPEAKERS: ReadonlySet<string> = new Set(Object.values(TRANSCRIPT_SPEAKER));

function isVoiceCallLine(value: UnparsedWireValue): boolean {
  return (
    isRecord(value) &&
    isWireString(value.rowId) &&
    isWireString(value.speaker) &&
    TRANSCRIPT_SPEAKERS.has(value.speaker) &&
    isWireString(value.words) &&
    isWireNumber(value.startMs) &&
    isWireNumber(value.endMs)
  );
}

function isOptionalCallTranscript(value: UnparsedWireValue): boolean {
  if (value === undefined) return true;
  return (
    isRecord(value) &&
    isOptionalWireString(value.voiceSessionId) &&
    Array.isArray(value.lines) &&
    value.lines.every(isVoiceCallLine)
  );
}

export function isVoiceView(value: UnparsedWireValue): value is VoiceView & WireRecord {
  if (!isRecord(value)) return false;
  if (!isLiveStatus(value.voiceStatus)) return false;
  if (!isOptionalWireString(value.voiceError) || !isOptionalWireString(value.voiceNotice))
    return false;
  if (!isWireBoolean(value.talkOpening)) return false;
  if (!isOptionalWireString(value.callTaskId)) return false;
  if (!isOptionalCallTranscript(value.callTranscript)) return false;
  if (!isOptionalWireString(value.lukeEndedCall)) return false;
  if (!isWireBoolean(value.speakerMuted)) return false;
  if (!isWireBoolean(value.listening) || !isWireBoolean(value.lukeSpeaking)) return false;
  return (
    isOptionalWireStrings(value.lukeCaptions) && isOptionalWireStrings(value.developerCaptions)
  );
}
