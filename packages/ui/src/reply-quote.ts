export const MAX_REPLY_CHARS = 2000;

const ELLIPSIS = "…";
const NEWLINE = "\n";

export const QUOTE_GAP = "\n\n";

const BLANK_LINES = /\n[^\S\n]*(?:\n[^\S\n]*)+\n/gu;

const TRAILING_SPACES = /[^\S\n]+$/gmu;

const QUOTE_LINE = /^>(?: |$)/u;

export const MESSAGE_BLOCK = {
  QUOTE: "quote",
  WORDS: "words",
} as const;

export type MessageBlock =
  | { readonly kind: typeof MESSAGE_BLOCK.QUOTE; readonly words: string }
  | { readonly kind: typeof MESSAGE_BLOCK.WORDS; readonly lines: readonly string[] };

export function cutReply(reply: string, chars: number): string {
  if (reply.length <= chars) return reply;
  const keep = chars - ELLIPSIS.length;
  return keep <= 0 ? "" : `${reply.slice(0, keep).trimEnd()}${ELLIPSIS}`;
}

export function replyOf(picked: string): string {
  const words = picked
    .replace(/\r\n?/gu, NEWLINE)
    .replace(TRAILING_SPACES, "")
    .replace(BLANK_LINES, QUOTE_GAP)
    .trim();
  return cutReply(words, MAX_REPLY_CHARS);
}

export function quoteOf(reply: string): string {
  return reply
    .split(NEWLINE)
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join(NEWLINE);
}

function quoteEnd(lines: readonly string[], at: number): number | undefined {
  if (!QUOTE_LINE.test(lines[at] ?? "")) return undefined;
  if (at > 0 && lines[at - 1] !== "") return undefined;
  let end = at;
  while (end < lines.length && QUOTE_LINE.test(lines[end] ?? "")) end += 1;
  return end < lines.length && lines[end] !== "" ? undefined : end;
}

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
    words.pop();
    if (words.length > 0) blocks.push({ kind: MESSAGE_BLOCK.WORDS, lines: words });
    words = [];
    const quoted = lines.slice(at, end).map((line) => line.slice(2));
    blocks.push({ kind: MESSAGE_BLOCK.QUOTE, words: quoted.join(NEWLINE) });
    at = end + 1;
    if (at === lines.length) words.push("");
  }
  if (words.length > 0 || blocks.length === 0) {
    blocks.push({ kind: MESSAGE_BLOCK.WORDS, lines: words.length > 0 ? words : [""] });
  }
  return blocks;
}

export function messageText(blocks: readonly MessageBlock[]): string {
  return blocks
    .map((block) =>
      block.kind === MESSAGE_BLOCK.QUOTE ? quoteOf(block.words) : block.lines.join(NEWLINE),
    )
    .join(QUOTE_GAP);
}
