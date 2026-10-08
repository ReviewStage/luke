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

/**
 * Each pattern below is read over model text, so each is written to scan in
 * linear time: a quantified run never borders another that could take the
 * same characters, and a span's content excludes its own delimiter, so a
 * failed match stops at the next one rather than at the end of the line.
 */

/** A fence line of a code block: three or more ticks or tildes, with an optional language. */
const CODE_FENCE = /^[ \t]*(?:`{3,}|~{3,})[^`]*$/u;
/** A thematic break: a line of only dashes, stars, or underscores, three or more. */
const THEMATIC_BREAK = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
/** Blockquote marks, each a `>` and the spacing after it. */
const BLOCKQUOTE = /^[ \t]*(?:>[ \t]*)*/u;
/** An ATX heading's opening hashes. */
const HEADING_OPEN = /^#{1,6}[ \t]+/u;
/** A bullet or numbered list marker, then a task box, if there is one. */
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/u;
/** An image or a link, inline or by reference: its text stands, its target goes. */
const IMAGE_OR_LINK = /!?\[([^[\]]*)\](?:\([^()]*\)|\[[^[\]]*\])/gu;
/** An autolink: the address stands without its angle brackets. */
const AUTOLINK = /<((?:https?|mailto):[^<>\s]+)>/gu;
/** Inline code: its content stands without the ticks around it. */
const INLINE_CODE = /(?<!`)(`+)([^`]+)\1(?!`)/gu;
/** Strong emphasis by stars, delimited on both sides by non-space. */
const STAR_STRONG = /\*\*(?=\S)([^*]+?)(?<=\S)\*\*/gu;
/** Strikethrough, delimited on both sides by non-space. */
const STRIKETHROUGH = /~~(?=\S)([^~]+?)(?<=\S)~~/gu;
/** Strong emphasis by underscores, never inside a word, as Markdown reads it. */
const UNDERSCORE_STRONG = /(?<![\w_])__(?=\S)([^_]+?)(?<=\S)__(?![\w_])/gu;
/** Emphasis by stars, never touching a word on its outside, so `2 * 3 * 4` stands. */
const STAR_EMPHASIS = /(?<![\w*])\*(?=[^\s*])([^*]+?)(?<=\S)\*(?![\w*])/gu;
/** Emphasis by underscores, never inside a word, so `snake_case_name` stands. */
const UNDERSCORE_EMPHASIS = /(?<![\w_])_(?=[^\s_])([^_]+?)(?<=\S)_(?![\w_])/gu;

/** A heading's text without the closing hashes it may carry, which stand only after a space. */
function withoutClosingHashes(heading: string): string {
  const text = heading.trimEnd();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end === text.length) return text;
  if (end === 0) return "";
  return /\s/u.test(text[end - 1] ?? "") ? text.slice(0, end).trimEnd() : text;
}

/** A line without its blockquote marks and its heading or list marker. */
function blockText(line: string): string {
  const quoted = line.replace(BLOCKQUOTE, "");
  if (HEADING_OPEN.test(quoted)) return withoutClosingHashes(quoted.replace(HEADING_OPEN, ""));
  return quoted.replace(LIST_MARKER, "");
}

/**
 * One line without its block syntax and its inline syntax. Note that single
 * stars go before pairs, because a pair's content excludes stars, so
 * emphasis nested inside strong emphasis must be gone first.
 */
function spokenLine(line: string): string {
  if (THEMATIC_BREAK.test(line)) return "";
  return blockText(line)
    .replace(IMAGE_OR_LINK, "$1")
    .replace(AUTOLINK, "$1")
    .replace(INLINE_CODE, (_, _ticks: string, code: string) => code.trim())
    .replace(STAR_EMPHASIS, "$1")
    .replace(STAR_STRONG, "$1")
    .replace(STRIKETHROUGH, "$1")
    .replace(UNDERSCORE_EMPHASIS, "$1")
    .replace(UNDERSCORE_STRONG, "$1");
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
