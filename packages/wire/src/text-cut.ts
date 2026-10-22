/**
 * text-cut.ts -- a text cut on a line to a bound, as a read answers a long one: what eve's reads of a page or a plan keep, and what a runner keeps of an event too large to post.
 *
 * A door of its own, which imports nothing, so the agent runner's bundle
 * reaches it without the barrel's graph.
 */

/** A text as a read answers it, cut to a bound, and how many characters of it were left out. */
export interface TextCut {
  readonly text: string;
  readonly leftOutChars: number;
}

/** A text cut on a line to a bound, and how many characters were left out; whole where it fits. */
export function cutOnLine(text: string, maximumChars: number): TextCut {
  if (text.length <= maximumChars) return { text, leftOutChars: 0 };
  const lineEnd = text.lastIndexOf("\n", maximumChars);
  const kept = text.slice(0, lineEnd > 0 ? lineEnd : maximumChars);
  return { text: kept, leftOutChars: text.length - kept.length };
}
