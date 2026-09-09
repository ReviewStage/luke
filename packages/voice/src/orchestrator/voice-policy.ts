import type { RealtimeVoiceSpeed } from "@sidecar/realtime";
import { REALTIME_STATUS, type RealtimeStatus, type RealtimeVoice } from "@sidecar/realtime";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  streamingConversationEntry,
} from "@sidecar/session";
import { REPLY_KIND, type ReplyKind } from "./voice-call.js";

/**
 * What a changed voice on a live call should do. The API locks a session's
 * voice the moment the model first speaks, so the one way to change it now is
 * to open a new call — but a spoken "change your voice" is confirmed in the
 * old one, so the restart waits until that turn has ended.
 */
export const VOICE_RESTART = {
  /** Nothing to do: no change, or a change that is not owed a live call. */
  NONE: "none",
  /** A restart is owed, but the turn under way has to finish first. */
  WAIT: "wait",
  /** The call ended on its own; the next one is minted in the new voice. */
  DROP: "drop",
  /** The call is idle enough to close and open again in the new voice. */
  RESTART: "restart",
} as const;

export type VoiceRestart = (typeof VOICE_RESTART)[keyof typeof VOICE_RESTART];

/**
 * How long a voice failure stays on the caption strip. The strip takes no
 * pointer, so time is its only dismissal: long enough to be read twice, short
 * enough that the shape does not wear a fault all afternoon. The next attempt
 * clears it sooner — connecting starts by reporting nothing wrong.
 */
export const VOICE_ERROR_NOTICE_MS = 12_000;

/**
 * The stream the meter should listen to for this status, or none. Typed over
 * the stream itself so the rule can be tested without a MediaStream.
 */
export function activeVoiceStream<T>(input: {
  status: RealtimeStatus;
  local: T | undefined;
  remote: T | undefined;
}): T | undefined {
  if (input.status === REALTIME_STATUS.RESPONDING) return input.remote;
  if (input.status === REALTIME_STATUS.LISTENING) return input.local;
  return undefined;
}

/**
 * The words the panels draw under the shape, one entry per response so
 * back-to-back responses stack apart instead of running together. Luke's
 * captions are offered only when there is a reason to read them and the reply
 * they belong to is his turn: the captions preference, a reply answering an
 * ask the developer typed, or an output that would swallow the speech.
 */
export function lukeCaptionsToShow(input: {
  captionsEnabled: boolean;
  typedAsk: boolean;
  outputSilent: boolean;
  status: RealtimeStatus;
  captions: readonly string[] | undefined;
}): readonly string[] | undefined {
  if (
    (input.captionsEnabled || input.typedAsk || input.outputSilent) &&
    input.status === REALTIME_STATUS.RESPONDING
  ) {
    return input.captions;
  }
  return undefined;
}

/**
 * Whether a talk-key press has a call to open before the session is asked. A
 * latched turn is already open — that press is someone saying they are done,
 * which is the release's to answer. Otherwise a press against no microphone
 * call has seconds of handshake ahead of it, and the meter has to answer the
 * press, not the handshake.
 */
export function talkKeyPress(input: { latched: boolean; microphoneCall: boolean }) {
  return { openCall: !input.latched && !input.microphoneCall };
}

/**
 * Whether the press-wait meter should stay up. Connecting is still the
 * handshake; a pending turn is a takeover still owed a call — the meter must
 * ride across Luke's own call settling on its way to the developer's.
 */
export function talkOpeningHolds(input: { status: RealtimeStatus; turnPending: boolean }): boolean {
  return input.status === REALTIME_STATUS.CONNECTING || input.turnPending;
}

/**
 * Whether a typed ask's reply is still the one being spoken. The caption of a
 * typed conversation stays readable whatever the preference says, and clears
 * the moment the turn moves on.
 */
export function typedAskHolds(status: RealtimeStatus): boolean {
  return status === REALTIME_STATUS.RESPONDING;
}

/**
 * Whether a changed pace should be carried onto the call now open. The first
 * snapshot is the stored value rather than a change, and with no next value
 * there is nothing to apply — the next call is minted at the stored pace.
 */
export function liveSpeedApplies(
  previous: RealtimeVoiceSpeed | undefined,
  next: RealtimeVoiceSpeed | undefined,
): boolean {
  return next !== undefined && previous !== undefined && previous !== next;
}

/** Whether a changed voice is still owed a restart, and what to do about it now. */
export interface VoiceRestartDecision {
  due: boolean;
  action: VoiceRestart;
}

/**
 * What a changed voice should do to a call already up. A call being opened
 * counts as one to reopen: its credential may already have been minted in the
 * old voice. A call that ended on its own owes nothing.
 */
export function voiceRestartAction(input: {
  previous: RealtimeVoice | undefined;
  next: RealtimeVoice | undefined;
  live: boolean;
  due: boolean;
  status: RealtimeStatus;
}): VoiceRestartDecision {
  if (input.next === undefined) return { due: input.due, action: VOICE_RESTART.NONE };
  const due =
    input.due || (input.previous !== undefined && input.previous !== input.next && input.live);
  if (!due) return { due: false, action: VOICE_RESTART.NONE };
  if (
    input.status === REALTIME_STATUS.IDLE ||
    input.status === REALTIME_STATUS.FAILED ||
    input.status === REALTIME_STATUS.UNAVAILABLE
  ) {
    return { due: false, action: VOICE_RESTART.DROP };
  }
  if (input.status !== REALTIME_STATUS.READY) return { due: true, action: VOICE_RESTART.WAIT };
  return { due: false, action: VOICE_RESTART.RESTART };
}

/**
 * Whether a status still has a call behind it. A gone call takes its
 * half-transcribed spoken turns with it: their completed transcripts can no
 * longer arrive, so a preview left standing would stream forever.
 */
export function spokenAskPreviewSurvives(status: RealtimeStatus): boolean {
  return (
    status !== REALTIME_STATUS.IDLE &&
    status !== REALTIME_STATUS.FAILED &&
    status !== REALTIME_STATUS.UNAVAILABLE
  );
}

/**
 * The lines still being said, for Conversation to draw under the settled thread:
 * the developer's spoken turns as the service transcribes them, then the
 * reply or announcement as its words are generated — the ask precedes its
 * answer. Presentation only, so each line mirrors exactly what its own
 * recording path will keep: a briefing settles as an announcement, and any
 * other caption settles as a reply.
 */
export function liveConversationEntries(input: {
  spokenAskPreviews: ReadonlyMap<string, string>;
  captions: readonly string[] | undefined;
  kind: ReplyKind | undefined;
}): readonly ConversationEntry[] {
  const lines: ConversationEntry[] = [];
  for (const words of input.spokenAskPreviews.values()) {
    const ask = streamingConversationEntry(CONVERSATION_ENTRY_KIND.SPOKEN_ASK, words);
    if (ask) lines.push(ask);
  }
  const briefing = input.kind === REPLY_KIND.BRIEFING;
  if (input.captions) {
    const speech = streamingConversationEntry(
      briefing ? CONVERSATION_ENTRY_KIND.ANNOUNCEMENT : CONVERSATION_ENTRY_KIND.REPLY,
      input.captions.join(" "),
    );
    if (speech) lines.push(speech);
  }
  return lines;
}
