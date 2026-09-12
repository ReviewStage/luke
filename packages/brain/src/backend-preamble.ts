import { BRAIN_REQUEST_ORIGIN } from "./requests.js";
import { BRAIN_TURN_KIND, BRAIN_TURN_TRIGGER, type BrainTurnDescription } from "./turn.js";
import { BRAIN_PERSONA } from "./workspace-seeds.js";

/**
 * How a turn is voiced. A spoken ask is delegated by the live voice model,
 * which carries Luke's persona itself and expects facts back, not sentences:
 * its turn runs under the GPT Live delegation guide's backend preamble
 * ("Start with your existing backend prompt") and drops the persona. The one
 * line the guide does not write is the one this build's relay needs: a
 * read-only answer's words are forwarded as soon as they form, so words
 * written beside a call would be spoken as the answer. Every other turn keeps
 * the persona and no preamble.
 */

export const BACKEND_PREAMBLE: string = [
  "## Voice conversation context",
  "You are helping an assistant in a live voice conversation. Transcripts",
  "can contain mistakes, unfinished phrases, and later corrections. Use",
  "the latest context and verified records. If a needed detail is still",
  "unclear, ask for that detail instead of guessing.",
  "",
  "## Return the result",
  "Return the relevant facts, whether the task is complete, and what comes next.",
  "Use confirmed values. Do not invent a successful action.",
  "When you call a tool, return no words in the same answer: the words of a",
  "read are forwarded as soon as they form, so a line written before the",
  "result is known would be spoken as though it were the answer.",
].join("\n");

export type BrainPromptVoice = { readonly persona: string } | { readonly backendPreamble: string };

/** Whether a turn answers a live voice conversation as its backend: an ask's turn whose ask was spoken. */
export function isSpokenTurn(turn: BrainTurnDescription): boolean {
  return (
    turn.kind === BRAIN_TURN_KIND.TURN &&
    turn.trigger === BRAIN_TURN_TRIGGER.ASK &&
    turn.askOrigin === BRAIN_REQUEST_ORIGIN.SPOKEN
  );
}

/** The voice section a turn's prompt carries: the backend preamble on a spoken turn, the persona on every other. */
export function brainPromptVoice(turn: BrainTurnDescription): BrainPromptVoice {
  return isSpokenTurn(turn) ? { backendPreamble: BACKEND_PREAMBLE } : { persona: BRAIN_PERSONA };
}
