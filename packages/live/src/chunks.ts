import { ESTIMATED_CHARS_PER_TOKEN, estimatedTokens } from "./tokens.js";
import { trimmedText } from "./trimmed-text.js";

/**
 * Cutting a text into appends. The API bounds each append at 500 tokens and
 * counts them itself; the bound is held here against the package's own
 * estimate, and a text is cut at sentence ends, so what the model is handed
 * to say is whole sentences and the model can begin on the first before the
 * last has been sent.
 */

export const APPEND_TOKEN_BOUND = 500;

/** The end of a sentence: closing punctuation, optionally quoted, then whitespace. */
const SENTENCE_END = /(?<=[.!?…]["'”’)\]]*)\s+/u;

/**
 * Greedily packs units into runs under the bound, joined by a space, in
 * order. A unit alone over the bound is passed through whole; the caller
 * decides what a unit is.
 */
function packed(units: readonly string[]): readonly string[] {
  const runs: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current} ${unit}` : unit;
    if (estimatedTokens(candidate) <= APPEND_TOKEN_BOUND) {
      current = candidate;
      continue;
    }
    if (current) runs.push(current);
    current = unit;
  }
  if (current) runs.push(current);
  return runs;
}

/** A word alone over the bound is cut by characters, so it still leaves in bounded pieces. */
function boundedWords(sentence: string): readonly string[] {
  const cut = APPEND_TOKEN_BOUND * ESTIMATED_CHARS_PER_TOKEN;
  return sentence.split(" ").flatMap((word) => {
    const pieces: string[] = [];
    for (let index = 0; index < word.length; index += cut) {
      pieces.push(word.slice(index, index + cut));
    }
    return pieces;
  });
}

/**
 * One sentence that alone exceeds the bound is cut between words, so a text
 * without a sentence end still leaves in bounded pieces rather than as one
 * refused append.
 */
function pieces(sentence: string): readonly string[] {
  if (estimatedTokens(sentence) <= APPEND_TOKEN_BOUND) return [sentence];
  return packed(boundedWords(sentence));
}

/**
 * The appends one text becomes, each a run of whole sentences under the
 * bound, in order; nothing for a blank. Newlines are folded to spaces, since
 * an append is plain text meant to be heard and a paragraph break says
 * nothing aloud.
 */
export function chunkForAppend(text: string): readonly string[] {
  const flattened = trimmedText(text.replace(/\s+/gu, " "));
  if (flattened === undefined) return [];
  return packed(flattened.split(SENTENCE_END).flatMap(pieces));
}
