/**
 * reply-quote.ts -- words picked out of an agent's message to answer: the replies as the box holds them, and the message they lead once sent.
 *
 * A reply is held apart from the words being written, as ChatGPT's and
 * Claude's are, so the box shows it as a quote over the field rather than
 * as lines in the words, and replies stack there, one quote each, in the
 * order they were added. They go with the message as Markdown blockquotes
 * leading the words, so the agent reads them as any quote and the
 * transcript draws them as quotes, and nothing on the wire knows a reply
 * from words. The
 * picked words are kept as the selection read them, but for the blank lines
 * around them and runs of them inside, and cut to `MAX_REPLY_CHARS`, so a
 * whole long message picked still leaves the message room for its words;
 * where the words fill that room anyway, the replies give way to them.
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

/** A reply cut from its end until it takes no more than `room`; empty where nothing of it fits. */
function fitted(reply: string, room: number): string {
  let kept = reply;
  while (kept !== "" && replyRoom(kept) > room) {
    const keep = kept.length - (replyRoom(kept) - room) - ELLIPSIS.length;
    kept = keep <= 0 ? "" : `${kept.slice(0, keep).trimEnd()}${ELLIPSIS}`;
  }
  return kept;
}

/** The replies with one more at their end; the same where it is empty or already among them. */
export function withReplyAdded(replies: readonly string[], reply: string): readonly string[] {
  return reply === "" || replies.includes(reply) ? replies : [...replies, reply];
}

/**
 * The message the replies and the words written under them send as: each
 * reply quoted, in the order they were added, a blank line after each,
 * then the words; the words alone where there is no reply. Note that where
 * they run past `maxChars` the replies give way, the latest first, cut
 * from their ends, since each is an excerpt already and the words are what
 * the developer wrote.
 */
export function withReplies(
  replies: readonly string[],
  words: string,
  maxChars = Number.POSITIVE_INFINITY,
): string {
  let room = maxChars - words.length;
  const quotes: string[] = [];
  for (const reply of replies) {
    const kept = fitted(reply, room);
    if (kept === "") break;
    quotes.push(quoteOf(kept));
    room -= replyRoom(kept);
  }
  return [...quotes, words].join(QUOTE_GAP);
}
