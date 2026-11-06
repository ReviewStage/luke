const CODE_FENCE = /^[ \t]*(?:`{3,}|~{3,})[^`]*$/u;
const THEMATIC_BREAK = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
const BLOCKQUOTE = /^[ \t]*(?:>[ \t]*)*/u;
const HEADING_OPEN = /^#{1,6}[ \t]+/u;
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/u;
const IMAGE_OR_LINK = /!?\[([^[\]]*)\](?:\([^()]*\)|\[[^[\]]*\])/gu;
const AUTOLINK = /<((?:https?|mailto):[^<>\s]+)>/gu;
const INLINE_CODE = /(?<!`)(`+)([^`]+)\1(?!`)/gu;
const STAR_STRONG = /\*\*(?=\S)([^*]+?)(?<=\S)\*\*/gu;
const STRIKETHROUGH = /~~(?=\S)([^~]+?)(?<=\S)~~/gu;
const UNDERSCORE_STRONG = /(?<![\w_])__(?=\S)([^_]+?)(?<=\S)__(?![\w_])/gu;
const STAR_EMPHASIS = /(?<![\w*])\*(?=[^\s*])([^*]+?)(?<=\S)\*(?![\w*])/gu;
const UNDERSCORE_EMPHASIS = /(?<![\w_])_(?=[^\s_])([^_]+?)(?<=\S)_(?![\w_])/gu;

function withoutClosingHashes(heading: string): string {
  const text = heading.trimEnd();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end === text.length) return text;
  if (end === 0) return "";
  return /\s/u.test(text[end - 1] ?? "") ? text.slice(0, end).trimEnd() : text;
}

function blockText(line: string): string {
  const quoted = line.replace(BLOCKQUOTE, "");
  if (HEADING_OPEN.test(quoted)) return withoutClosingHashes(quoted.replace(HEADING_OPEN, ""));
  return quoted.replace(LIST_MARKER, "");
}

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
