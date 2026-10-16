/**
 * reply-quote.ts -- words picked out of an agent's message to answer, held in a message as quotes between the developer's own lines: the reply as picked, and a message read as its blocks and written back.
 *
 * A reply is laid into the message box where the caret stands, as a quote
 * block of its own, and the developer writes under it, so a message may
 * answer several of the agent's points, each under its quote, or ask one
 * thing under several stacked together. The message is one string all the
 * same, as the wire takes it: each quote a Markdown blockquote with a blank
 * line before and after it, so the agent reads it as any quote, the
 * transcript draws it as one, and the line after a quote is never pulled
 * into it. Read back, as a draft or a message that did not go comes back
 * into the box, a run of quoted lines with a blank line or the message's
 * edge on each side is a quote again; any other line is the words it is.
 * The picked words are kept as the selection read them, but for the blank
 * lines around them and runs of them inside, and cut to `MAX_REPLY_CHARS`,
 * so a whole long message picked still leaves the message room for its
 * words.
 */

/** The most characters a reply keeps of the words picked, its ellipsis included. */
export const MAX_REPLY_CHARS = 2000;

const ELLIPSIS = "…";
const NEWLINE = "\n";

/** What stands between a quote and the block beside it: one blank line. */
export const QUOTE_GAP = "\n\n";

/** Two or more blank lines, which a selection across a message's blocks holds between them. */
const BLANK_LINES = /\n[^\S\n]*(?:\n[^\S\n]*)+\n/gu;

/** Spaces at a line's end. */
const TRAILING_SPACES = /[^\S\n]+$/gmu;

/** A line of a blockquote: `>` alone, or `> ` and its words. */
const QUOTE_LINE = /^>(?: |$)/u;

/** The kinds of block a message is read as. */
export const MESSAGE_BLOCK = {
  /** Words of the agent's, quoted. */
  QUOTE: "quote",
  /** The developer's own lines, as typed. */
  WORDS: "words",
} as const;

/** One block of a message: a quote of the agent's words, or a run of the developer's lines. */
export type MessageBlock =
  | { readonly kind: typeof MESSAGE_BLOCK.QUOTE; readonly words: string }
  | { readonly kind: typeof MESSAGE_BLOCK.WORDS; readonly lines: readonly string[] };

/** A reply cut from its end to `chars` characters at most, its ellipsis included; empty where no word of it fits. */
export function cutReply(reply: string, chars: number): string {
  if (reply.length <= chars) return reply;
  const keep = chars - ELLIPSIS.length;
  return keep <= 0 ? "" : `${reply.slice(0, keep).trimEnd()}${ELLIPSIS}`;
}

/** The reply the words picked stand for: trimmed, one blank line at most between their blocks, and cut to the bound; empty where nothing but space was picked. */
export function replyOf(picked: string): string {
  const words = picked
    .replace(/\r\n?/gu, NEWLINE)
    .replace(TRAILING_SPACES, "")
    .replace(BLANK_LINES, QUOTE_GAP)
    .trim();
  return cutReply(words, MAX_REPLY_CHARS);
}

/** A reply as a Markdown blockquote, every line of it quoted. */
export function quoteOf(reply: string): string {
  return reply
    .split(NEWLINE)
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join(NEWLINE);
}

/** Where a quote that starts at `at` ends, past its last line; nothing where no quote starts there, a blank line or the message's edge on either side. */
function quoteEnd(lines: readonly string[], at: number): number | undefined {
  if (!QUOTE_LINE.test(lines[at] ?? "")) return undefined;
  if (at > 0 && lines[at - 1] !== "") return undefined;
  let end = at;
  while (end < lines.length && QUOTE_LINE.test(lines[end] ?? "")) end += 1;
  return end < lines.length && lines[end] !== "" ? undefined : end;
}

/**
 * A message read as its blocks: each quote, the blank lines that only part
 * it from its neighbours left out, and the developer's lines between, as
 * they stand. Words with no quote are one block of their lines, and no
 * words at all are one empty line.
 */
export function messageBlocks(text: string): readonly MessageBlock[] {
  const lines = text.split(NEWLINE);
  const blocks: MessageBlock[] = [];
  let words: string[] = [];
  let at = 0;
  while (at < lines.length) {
    const end = quoteEnd(lines, at);
    if (end === undefined) {
      words.push(lines[at] ?? "");
      at += 1;
      continue;
    }
    // Note that the blank line before a quote is the gap, unless the quote before it took it.
    words.pop();
    if (words.length > 0) blocks.push({ kind: MESSAGE_BLOCK.WORDS, lines: words });
    words = [];
    const quoted = lines.slice(at, end).map((line) => line.slice(2));
    blocks.push({ kind: MESSAGE_BLOCK.QUOTE, words: quoted.join(NEWLINE) });
    // The blank line after it is the gap too, and where it ends the message, an empty line follows.
    at = end + 1;
    if (at === lines.length) words.push("");
  }
  if (words.length > 0 || blocks.length === 0) {
    blocks.push({ kind: MESSAGE_BLOCK.WORDS, lines: words.length > 0 ? words : [""] });
  }
  return blocks;
}

/** A message written from its blocks: each quote a blockquote, the developer's lines as they stand, a blank line between a quote and its neighbours. */
export function messageText(blocks: readonly MessageBlock[]): string {
  return blocks
    .map((block) =>
      block.kind === MESSAGE_BLOCK.QUOTE ? quoteOf(block.words) : block.lines.join(NEWLINE),
    )
    .join(QUOTE_GAP);
}
