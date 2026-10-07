// spoken-prose.ts -- a reply's text as the words a voice says, with the Markdown that is only for display taken out.

/**
 * The model writes a reply for the screen as readily as for the ear, so a
 * reply can arrive with emphasis, inline code, headings, list markers, and
 * links in it. The stored reply keeps them, because the Conversation renders
 * them; what is handed to the voice is the facts without the syntax, as the
 * live delegation guide asks ("Keep ... Markdown intended for display in the
 * backend"). Note that the reading is deliberately small: it drops what a
 * voice would read out as punctuation and keeps every word, so a symbol that
 * is not Markdown (a star in arithmetic, an underscore inside a name) is
 * left as written.
 */

/** A fence line of a code block: three or more ticks or tildes, with an optional language. */
const CODE_FENCE = /^\s*(`{3,}|~{3,})[^`]*$/u;
/** A thematic break: a line of only dashes, stars, or underscores, three or more. */
const THEMATIC_BREAK = /^\s*([-*_])(\s*\1){2,}\s*$/u;
/** What opens a block line: blockquote marks, then a heading, a list marker, and a task box, each optional. */
const BLOCK_PREFIX =
  /^\s*(?:>\s?)*\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+(?:\[[ xX]\]\s+)?)?/u;
/** A heading line, read before its prefix goes so its closing hashes can go too. */
const HEADING_OPEN = /^\s*(?:>\s?)*\s*#{1,6}\s/u;
/** The closing hashes an ATX heading may carry. */
const HEADING_CLOSE = /\s+#+\s*$/u;
/** An image or a link, inline or by reference: its text stands, its target goes. */
const IMAGE_OR_LINK = /!?\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/gu;
/** An autolink: the address stands without its angle brackets. */
const AUTOLINK = /<((?:https?|mailto):[^>\s]+)>/gu;
/** Inline code: its content stands without the ticks around it. */
const INLINE_CODE = /(`+)(.+?)\1/gu;
/** Strong emphasis by stars, or strikethrough, delimited on both sides by non-space. */
const STRONG = /(\*\*|~~)(?=\S)(.+?)(?<=\S)\1/gu;
/** Strong emphasis by underscores, never inside a word, as Markdown reads it. */
const UNDERSCORE_STRONG = /(?<![\w_])__(?=\S)(.+?)(?<=\S)__(?![\w_])/gu;
/** Emphasis by stars, never touching a word on its outside, so `2 * 3 * 4` stands. */
const STAR_EMPHASIS = /(?<![\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\w*])/gu;
/** Emphasis by underscores, never inside a word, so `snake_case_name` stands. */
const UNDERSCORE_EMPHASIS = /(?<![\w_])_(?=\S)([^_]+?)(?<=\S)_(?![\w_])/gu;

/** One line without its block syntax and its inline syntax. */
function spokenLine(line: string): string {
  if (THEMATIC_BREAK.test(line)) return "";
  const heading = HEADING_OPEN.test(line);
  const unprefixed = line.replace(BLOCK_PREFIX, "");
  return (heading ? unprefixed.replace(HEADING_CLOSE, "") : unprefixed)
    .replace(IMAGE_OR_LINK, "$1")
    .replace(AUTOLINK, "$1")
    .replace(INLINE_CODE, (_, _ticks: string, code: string) => code.trim())
    .replace(STRONG, "$2")
    .replace(UNDERSCORE_STRONG, "$1")
    .replace(STAR_EMPHASIS, "$1")
    .replace(UNDERSCORE_EMPHASIS, "$1");
}

/**
 * The text with its Markdown syntax removed and its words kept, line for
 * line, so a caller that cuts at line breaks still finds each list item and
 * heading on a line of its own. A code fence's own lines go and the lines
 * between them stand as written.
 */
export function spokenProse(text: string): string {
  const lines: string[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (CODE_FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    lines.push(fenced ? line : spokenLine(line));
  }
  return lines.join("\n");
}
