import {
  ARRIVAL_SPEECH_KIND,
  BRIEFING_SPEECH_KIND,
  CALENDAR_ONBOARDING_SPEECH_KIND,
  type ProactiveSpeechTurn,
} from "@sidecar/realtime";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";

/**
 * What crosses the bridge between the speech arbiter in the main process and
 * the mouth in the renderer. The arbiter owns every decision about what Luke
 * says unprompted and whether now; the mouth holds at most one offer at a
 * time and reports what became of it, by id, so the arbiter can offer the
 * next. No backlog ever stands in a renderer, and so none can be lost with one.
 */

/**
 * One turn the main process has decided to voice, handed to the mouth with an
 * absolute deadline. `speakBy` is read against the mouth's clock at the last
 * moment: news past it is settled stale rather than read out as though it
 * just happened, because the panel has shown the state the whole time.
 */
export interface SpeechOffer {
  id: string;
  speakBy: number;
  turn: ProactiveSpeechTurn;
}

/** The main process taking back an offer the mouth has not yet begun to speak. */
export interface SpeechWithdrawal {
  id: string;
}

/**
 * What the mouth reports of one offer. SPOKEN: the reply began. REFUSED: the
 * call could not be opened within its attempts. HELD: the announcement hold
 * began before the words were said, and the arbiter keeps the request for the
 * release. STALE: the deadline passed unspoken.
 */
export const SPEECH_OUTCOME = {
  SPOKEN: "spoken",
  REFUSED: "refused",
  HELD: "held",
  STALE: "stale",
} as const;

export type SpeechOutcome = (typeof SPEECH_OUTCOME)[keyof typeof SPEECH_OUTCOME];

const optionalString = (value: UnparsedWireValue): boolean =>
  value === undefined || isWireString(value);

export function isProactiveSpeechTurn(
  value: UnparsedWireValue,
): value is ProactiveSpeechTurn & WireRecord {
  if (!isRecord(value) || !isWireNumber(value.decidedAt) || !Number.isFinite(value.decidedAt)) {
    return false;
  }
  switch (value.kind) {
    case BRIEFING_SPEECH_KIND:
      return isWireString(value.briefing);
    case ARRIVAL_SPEECH_KIND:
      return optionalString(value.sessionTitle) && optionalString(value.talkKeyLabel);
    case CALENDAR_ONBOARDING_SPEECH_KIND:
      return true;
    default:
      return false;
  }
}

export function isSpeechOffer(value: UnparsedWireValue): value is SpeechOffer & WireRecord {
  return (
    isRecord(value) &&
    isWireString(value.id) &&
    value.id.length > 0 &&
    isWireNumber(value.speakBy) &&
    Number.isFinite(value.speakBy) &&
    isProactiveSpeechTurn(value.turn)
  );
}

export function isSpeechWithdrawal(
  value: UnparsedWireValue,
): value is SpeechWithdrawal & WireRecord {
  return isRecord(value) && isWireString(value.id) && value.id.length > 0;
}

export function isSpeechOutcome(value: UnparsedWireValue): value is SpeechOutcome {
  return (
    value === SPEECH_OUTCOME.SPOKEN ||
    value === SPEECH_OUTCOME.REFUSED ||
    value === SPEECH_OUTCOME.HELD ||
    value === SPEECH_OUTCOME.STALE
  );
}
