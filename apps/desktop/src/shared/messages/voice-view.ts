import { PRODUCT_EXCHANGE_KIND, type ProductExchangeKind } from "@sidecar/analytics";
import { LIVE_STATUS, type LiveStatus } from "@sidecar/live";
import { type LiveConversationLine, storedConversationEntry } from "@sidecar/session";
import {
  isOptionalWireString,
  isRecord,
  isUnitLevel,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";

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
  /**
   * Both speakers' rows of the standing call, each the ledger's row id, its
   * line as `streamingConversationEntry` builds it — a kind and words, and no
   * timestamp, because a line still growing has not happened yet — its span
   * on the session's timeline, and whether it has settled. A settled row is
   * still reported: the panel keeps
   * drawing it until the record shows it. The line is read under the unstrict
   * parse — the strict one refuses every unstamped line, which would drop the
   * whole report at exactly the edges that carry a caption.
   */
  liveConversationLines: readonly LiveConversationLine[];
  /**
   * Whether the developer is being heard and none of their words have been
   * transcribed yet, so Conversation can hold their place in the thread
   * before anything is written.
   */
  spokenAskPending: boolean;
  /** The plan the standing call is about, where the planning window opened it; none for a desk call or no call. */
  callPlanId: string | undefined;
}

/**
 * How loud each speaker is right now, in the unit interval. Two readings
 * rather than one because either may be talking under the other, and a panel
 * that draws one of them must not be handed the other's loudness.
 */
export interface VoiceLevels {
  developer: number;
  luke: number;
}

/** Nobody heard, which is what a panel draws before any reading arrives. */
export const SILENT_VOICE_LEVELS: VoiceLevels = { developer: 0, luke: 0 };

export function isVoiceLevels(value: UnparsedWireValue): value is VoiceLevels & WireRecord {
  return isRecord(value) && isUnitLevel(value.developer) && isUnitLevel(value.luke);
}

/**
 * The asks a panel forwards to the main process for the voice window to carry
 * out. No press decides anything in the panel: the talk key never travels this
 * way, because the main process routes it to the voice window directly.
 */
export const VOICE_COMMAND = {
  STOP_SPEAKING: "stop-speaking",
  REQUEST_MICROPHONE_ACCESS: "request-microphone-access",
  CLEAR_CONVERSATION: "clear-conversation",
} as const;

export type VoiceCommand = (typeof VOICE_COMMAND)[keyof typeof VOICE_COMMAND];

/**
 * What became of the one command with an outcome worth answering, a Clear:
 * refused when the stored thread could not be deleted, so the panel can say
 * so. The other commands answer nothing.
 */
export const VOICE_COMMAND_OUTCOME = {
  ACCEPTED: "accepted",
  REFUSED: "refused",
} as const;

export type VoiceCommandOutcome =
  (typeof VOICE_COMMAND_OUTCOME)[keyof typeof VOICE_COMMAND_OUTCOME];

const VOICE_COMMAND_OUTCOMES: ReadonlySet<string> = new Set(Object.values(VOICE_COMMAND_OUTCOME));

export function isVoiceCommandOutcome(value: UnparsedWireValue): value is VoiceCommandOutcome {
  return isWireString(value) && VOICE_COMMAND_OUTCOMES.has(value);
}

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
  liveConversationLines: [],
  spokenAskPending: false,
  callPlanId: undefined,
};

const LIVE_STATUSES: ReadonlySet<string> = new Set(Object.values(LIVE_STATUS));

export function isLiveStatus(value: UnparsedWireValue): value is LiveStatus {
  return isWireString(value) && LIVE_STATUSES.has(value);
}

const VOICE_COMMANDS: ReadonlySet<string> = new Set(Object.values(VOICE_COMMAND));

export function isVoiceCommand(value: UnparsedWireValue): value is VoiceCommand {
  return isWireString(value) && VOICE_COMMANDS.has(value);
}

function isOptionalWireStrings(value: UnparsedWireValue): value is readonly string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isWireString));
}

export function isVoiceView(value: UnparsedWireValue): value is VoiceView & WireRecord {
  if (!isRecord(value)) return false;
  if (!isLiveStatus(value.voiceStatus)) return false;
  if (!isOptionalWireString(value.voiceError) || !isOptionalWireString(value.voiceNotice))
    return false;
  if (!isWireBoolean(value.talkOpening)) return false;
  if (!isWireBoolean(value.spokenAskPending)) return false;
  if (!isOptionalWireString(value.callPlanId)) return false;
  if (!isWireBoolean(value.listening) || !isWireBoolean(value.lukeSpeaking)) return false;
  if (
    !isOptionalWireStrings(value.lukeCaptions) ||
    !isOptionalWireStrings(value.developerCaptions)
  ) {
    return false;
  }
  const lines = value.liveConversationLines;
  return Array.isArray(lines) && lines.every(isLiveConversationLine);
}

/** A span on the session's timeline: two finite offsets, running forward or coming together. */
function isSessionSpan(startMs: UnparsedWireValue, endMs: UnparsedWireValue): boolean {
  return (
    isWireNumber(startMs) &&
    isWireNumber(endMs) &&
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    startMs >= 0 &&
    startMs <= endMs
  );
}

function isLiveConversationLine(value: UnparsedWireValue): boolean {
  if (!isRecord(value) || !isWireString(value.rowId) || !isWireBoolean(value.settled)) return false;
  if (!isSessionSpan(value.startMs, value.endMs)) return false;
  if (!isOptionalWireString(value.voiceSessionId)) return false;
  const streaming = storedConversationEntry(value.entry, { strict: false });
  return streaming !== undefined && streaming.words.length > 0;
}

/**
 * Who opened the exchange the count is about. A session opened for Luke's own
 * speech was opened by no press, which is the whole of what tells his
 * announcement from a turn the developer took.
 */
export function voiceExchangeKind(input: { microphoneCall: boolean }): ProductExchangeKind {
  return input.microphoneCall ? PRODUCT_EXCHANGE_KIND.SPOKEN : PRODUCT_EXCHANGE_KIND.ANNOUNCEMENT;
}
