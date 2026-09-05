import { PRODUCT_EXCHANGE_KIND, type ProductExchangeKind } from "@sidecar/analytics";
import {
  type ConversationEntry,
  REALTIME_STATUS,
  type RealtimeStatus,
  storedConversationEntry,
} from "@sidecar/realtime";
import {
  isRecord,
  isWireBoolean,
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
export interface VoiceView {
  voiceStatus: RealtimeStatus;
  voiceError: string | undefined;
  voiceNotice: string | undefined;
  talkOpening: boolean;
  lukeCaptions: readonly string[] | undefined;
  liveConversationEntries: readonly ConversationEntry[];
}

/**
 * The asks a panel forwards to the main process for the voice window to carry
 * out. No press decides anything in the panel: the talk key never travels this
 * way, because the main process routes it to the voice window directly.
 */
export const VOICE_COMMAND = {
  ASK_TEXT: "ask-text",
  DISCARD_LISTENING: "discard-listening",
  STOP_SPEAKING: "stop-speaking",
  REQUEST_MICROPHONE_ACCESS: "request-microphone-access",
  CLEAR_CONVERSATION: "clear-conversation",
} as const;

export type VoiceCommand = (typeof VOICE_COMMAND)[keyof typeof VOICE_COMMAND];

/**
 * What became of a command that has an outcome worth answering: a typed ask,
 * so the composer can keep or clear its draft, and a Clear, so the panel can
 * say when the stored thread could not be deleted. Refused covers every way
 * an ask does not reach a conversation — the brain absent, the ask timed
 * out, the voice window gone or silent — because the composer's one question
 * is whether the developer's words are still theirs to retry. The other
 * commands answer nothing.
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
  voiceStatus: REALTIME_STATUS.IDLE,
  voiceError: undefined,
  voiceNotice: undefined,
  talkOpening: false,
  lukeCaptions: undefined,
  liveConversationEntries: [],
};

const REALTIME_STATUSES: ReadonlySet<string> = new Set(Object.values(REALTIME_STATUS));

export function isRealtimeStatus(value: UnparsedWireValue): value is RealtimeStatus {
  return isWireString(value) && REALTIME_STATUSES.has(value);
}

const VOICE_COMMANDS: ReadonlySet<string> = new Set(Object.values(VOICE_COMMAND));

export function isVoiceCommand(value: UnparsedWireValue): value is VoiceCommand {
  return isWireString(value) && VOICE_COMMANDS.has(value);
}

const optionalString = (value: UnparsedWireValue): boolean =>
  value === undefined || isWireString(value);

export function isVoiceView(value: UnparsedWireValue): value is VoiceView & WireRecord {
  if (!isRecord(value)) return false;
  if (!isRealtimeStatus(value.voiceStatus)) return false;
  if (!optionalString(value.voiceError) || !optionalString(value.voiceNotice)) return false;
  if (!isWireBoolean(value.talkOpening)) return false;
  const captions = value.lukeCaptions;
  if (captions !== undefined && !(Array.isArray(captions) && captions.every(isWireString))) {
    return false;
  }
  const entries = value.liveConversationEntries;
  return (
    Array.isArray(entries) && entries.every((entry) => storedConversationEntry(entry) !== undefined)
  );
}

/**
 * The exchange is live from the press to the end of the reply — the call
 * coming up, a turn being held, Luke speaking — and the media duck follows it.
 */
export function voiceExchangeActive(status: RealtimeStatus): boolean {
  return (
    status === REALTIME_STATUS.CONNECTING ||
    status === REALTIME_STATUS.LISTENING ||
    status === REALTIME_STATUS.RESPONDING
  );
}

/**
 * Who opened the exchange the count is about. Luke's own speak-only call has
 * no microphone to offer, which is the whole of what tells his announcement
 * from a turn the developer took; between the developer's own two ways in,
 * only the composer says so in advance, so the talk key is what is left.
 */
export function voiceExchangeKind(input: {
  microphoneCall: boolean;
  typedAsk: boolean;
}): ProductExchangeKind {
  if (!input.microphoneCall) return PRODUCT_EXCHANGE_KIND.ANNOUNCEMENT;
  return input.typedAsk ? PRODUCT_EXCHANGE_KIND.TYPED : PRODUCT_EXCHANGE_KIND.SPOKEN;
}
