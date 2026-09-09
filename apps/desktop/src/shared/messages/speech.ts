import { isProactiveSpeechTurn, type ProactiveSpeechTurn } from "@sidecar/realtime";
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

const SPEECH_OUTCOMES: ReadonlySet<string> = new Set(Object.values(SPEECH_OUTCOME));

export function isSpeechOutcome(value: UnparsedWireValue): value is SpeechOutcome {
  return isWireString(value) && SPEECH_OUTCOMES.has(value);
}
