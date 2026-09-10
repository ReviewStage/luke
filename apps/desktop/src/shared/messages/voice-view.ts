import { PRODUCT_EXCHANGE_KIND, type ProductExchangeKind } from "@sidecar/analytics";
import { LIVE_STATUS, type LiveStatus } from "@sidecar/live";
import { type ConversationEntry, storedConversationEntry } from "@sidecar/session";
import {
  isOptionalWireString,
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
  voiceStatus: LiveStatus;
  voiceError: string | undefined;
  voiceNotice: string | undefined;
  talkOpening: boolean;
  lukeCaptions: readonly string[] | undefined;
  /**
   * The lines still being said, as `streamingConversationEntry` builds them:
   * a kind and words, and no timestamp, because a line still growing has not
   * happened yet. Read under the unstrict parse for that reason — the strict
   * one refuses every unstamped line, which would drop the whole report at
   * exactly the edges that carry a caption.
   */
  liveConversationEntries: readonly ConversationEntry[];
  /**
   * Whether the developer is being heard and none of their words have been
   * transcribed yet, so Conversation can hold their place in the thread
   * before anything is written.
   */
  spokenAskPending: boolean;
}

/**
 * The asks a panel forwards to the main process for the voice window to carry
 * out. No press decides anything in the panel: the talk key never travels this
 * way, because the main process routes it to the voice window directly.
 */
export const VOICE_COMMAND = {
  DISCARD_LISTENING: "discard-listening",
  STOP_SPEAKING: "stop-speaking",
  REQUEST_MICROPHONE_ACCESS: "request-microphone-access",
  CLEAR_CONVERSATION: "clear-conversation",
} as const;

export type VoiceCommand = (typeof VOICE_COMMAND)[keyof typeof VOICE_COMMAND];

/**
 * What became of the one command with an outcome worth answering, a Clear:
 * refused when the stored thread could not be deleted, so the panel can say
 * so. The other commands answer nothing; a typed ask is not a command at all
 * but a brain submission, whose own result tells the composer whether the
 * draft is still the developer's to retry.
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
  voiceError: undefined,
  voiceNotice: undefined,
  talkOpening: false,
  lukeCaptions: undefined,
  liveConversationEntries: [],
  spokenAskPending: false,
};

const LIVE_STATUSES: ReadonlySet<string> = new Set(Object.values(LIVE_STATUS));

export function isLiveStatus(value: UnparsedWireValue): value is LiveStatus {
  return isWireString(value) && LIVE_STATUSES.has(value);
}

const VOICE_COMMANDS: ReadonlySet<string> = new Set(Object.values(VOICE_COMMAND));

export function isVoiceCommand(value: UnparsedWireValue): value is VoiceCommand {
  return isWireString(value) && VOICE_COMMANDS.has(value);
}

export function isVoiceView(value: UnparsedWireValue): value is VoiceView & WireRecord {
  if (!isRecord(value)) return false;
  if (!isLiveStatus(value.voiceStatus)) return false;
  if (!isOptionalWireString(value.voiceError) || !isOptionalWireString(value.voiceNotice))
    return false;
  if (!isWireBoolean(value.talkOpening)) return false;
  if (!isWireBoolean(value.spokenAskPending)) return false;
  const captions = value.lukeCaptions;
  if (captions !== undefined && !(Array.isArray(captions) && captions.every(isWireString))) {
    return false;
  }
  const entries = value.liveConversationEntries;
  return (
    Array.isArray(entries) &&
    entries.every((entry) => {
      const streaming = storedConversationEntry(entry, { strict: false });
      return streaming !== undefined && streaming.words.length > 0;
    })
  );
}

/**
 * Who opened the exchange the count is about. A session opened for Luke's own
 * speech was opened by no press, which is the whole of what tells his
 * announcement from a turn the developer took; a typed ask opens no session
 * of its own any more, so its reply counts under the session it is said into.
 */
export function voiceExchangeKind(input: { microphoneCall: boolean }): ProductExchangeKind {
  return input.microphoneCall ? PRODUCT_EXCHANGE_KIND.SPOKEN : PRODUCT_EXCHANGE_KIND.ANNOUNCEMENT;
}
