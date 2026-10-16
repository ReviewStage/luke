/**
 * reply-quote.ts -- words picked out of an agent's message to answer: the reply as the box holds it, and the message it leads once sent.
 *
 * A reply is held apart from the words being written, as ChatGPT's and
 * Claude's are, so the box shows it as one quote over the field rather than
 * as lines in the words. It goes with the message as a Markdown blockquote
 * leading the words, so the agent reads it as any quote and the transcript
 * draws it as one, and nothing on the wire knows a reply from words. The
 * picked words are kept as the selection read them, but for the blank lines
 * around them and runs of them inside, and cut to `MAX_REPLY_CHARS`, so a
 * whole long message picked still leaves the message room for its words;
 * where the words fill that room anyway, the reply gives way to them.
 */

/** The most characters a reply keeps of the words picked, its ellipsis included. */
export const MAX_REPLY_CHARS = 2000;

const ELLIPSIS = "…";

/** Two or more blank lines, which a selection across a message's blocks holds between them. */
const BLANK_LINES = /\n[^\S\n]*(?:\n[^\S\n]*)+\n/gu;

/** Spaces at a line's end. */
const TRAILING_SPACES = /[^\S\n]+$/gmu;

/** Where the quote ends and the words begin. */
const QUOTE_GAP = "\n\n";

/** The reply the words picked stand for: trimmed, one blank line at most between their blocks, and cut to the bound; empty where nothing but space was picked. */
export function replyOf(picked: string): string {
  const words = picked
    .replace(/\r\n?/gu, "\n")
    .replace(TRAILING_SPACES, "")
    .replace(BLANK_LINES, "\n\n")
    .trim();
  if (words.length <= MAX_REPLY_CHARS) return words;
  return `${words.slice(0, MAX_REPLY_CHARS - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

/** A reply as a Markdown blockquote, every line of it quoted. */
function quoteOf(reply: string): string {
  return reply
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

/** How many of a message's characters a reply takes, which the words written under it cannot. */
function replyRoom(reply: string): number {
  return reply === "" ? 0 : quoteOf(reply).length + QUOTE_GAP.length;
}

/**
 * The message a reply and the words written under it send as: the reply
 * quoted, a blank line, then the words; the words alone where there is no
 * reply. Note that where the two run past `maxChars` the reply gives way,
 * cut from its end, since it is an excerpt already and the words are what
 * the developer wrote.
 */
export function withReply(
  reply: string,
  words: string,
  maxChars = Number.POSITIVE_INFINITY,
): string {
  let quoted = reply;
  while (quoted !== "" && replyRoom(quoted) + words.length > maxChars) {
    const keep = quoted.length - (replyRoom(quoted) + words.length - maxChars) - ELLIPSIS.length;
    quoted = keep <= 0 ? "" : `${quoted.slice(0, keep).trimEnd()}${ELLIPSIS}`;
  }
  return quoted === "" ? words : `${quoteOf(quoted)}${QUOTE_GAP}${words}`;
}
