/**
 * A message's words read as Markdown, in the block structure a chat draws:
 * paragraphs and headings with their inline styles, a code block's verbatim
 * text, and the containers (quote, list, table) around the blocks inside
 * them. The dialect is the one coding agents write and GitHub renders —
 * CommonMark's blocks and emphasis, plus tables, strikethrough, task lists,
 * and bare web links — read leniently: whatever does not parse as Markdown
 * still reads as the words themselves, so a message never draws less than
 * the plain text it started as, and a marker whose closer has not arrived
 * yet (a reply still streaming) stands as the character it is until it has.
 *
 * Only HTTP and HTTPS destinations survive as links; a custom scheme is text,
 * so no message can dress an action up as a link. Raw HTML is text too.
 */

export const MARKDOWN_BLOCK_KIND = {
  PARAGRAPH: "paragraph",
  HEADING: "heading",
  CODE: "code",
  QUOTE: "quote",
  LIST: "list",
  TABLE: "table",
  RULE: "rule",
} as const;

export type MarkdownBlockKind = (typeof MARKDOWN_BLOCK_KIND)[keyof typeof MARKDOWN_BLOCK_KIND];

export const MARKDOWN_INLINE_KIND = {
  TEXT: "text",
  STRONG: "strong",
  EMPHASIS: "emphasis",
  STRIKETHROUGH: "strikethrough",
  CODE: "code",
  LINK: "link",
  BREAK: "break",
} as const;

export type MarkdownInlineKind = (typeof MARKDOWN_INLINE_KIND)[keyof typeof MARKDOWN_INLINE_KIND];

export const MARKDOWN_TABLE_ALIGNMENT = {
  LEADING: "leading",
  CENTER: "center",
  TRAILING: "trailing",
} as const;

export type MarkdownTableAlignment =
  (typeof MARKDOWN_TABLE_ALIGNMENT)[keyof typeof MARKDOWN_TABLE_ALIGNMENT];

export type MarkdownInline =
  | { kind: typeof MARKDOWN_INLINE_KIND.TEXT; text: string }
  | { kind: typeof MARKDOWN_INLINE_KIND.CODE; code: string }
  | { kind: typeof MARKDOWN_INLINE_KIND.BREAK }
  | {
      kind:
        | typeof MARKDOWN_INLINE_KIND.STRONG
        | typeof MARKDOWN_INLINE_KIND.EMPHASIS
        | typeof MARKDOWN_INLINE_KIND.STRIKETHROUGH;
      inlines: MarkdownInline[];
    }
  | { kind: typeof MARKDOWN_INLINE_KIND.LINK; href: string; inlines: MarkdownInline[] };

export interface MarkdownListItem {
  /** The number the item counts as: the list's own start, then one more per item. */
  ordinal: number;
  /**
   * Whether the item's task box is ticked, for an item that opened with one
   * (`[ ]` or `[x]`); absent for an ordinary item. The box must be the item's
   * first plain words: one inside a code span, emphasis, or link is the
   * author's own text.
   */
  checked?: boolean;
  blocks: MarkdownBlock[];
}

export type MarkdownBlock =
  | { kind: typeof MARKDOWN_BLOCK_KIND.PARAGRAPH; inlines: MarkdownInline[] }
  | { kind: typeof MARKDOWN_BLOCK_KIND.HEADING; level: number; inlines: MarkdownInline[] }
  | { kind: typeof MARKDOWN_BLOCK_KIND.CODE; language?: string; code: string }
  | { kind: typeof MARKDOWN_BLOCK_KIND.QUOTE; blocks: MarkdownBlock[] }
  | { kind: typeof MARKDOWN_BLOCK_KIND.LIST; ordered: boolean; items: MarkdownListItem[] }
  | {
      kind: typeof MARKDOWN_BLOCK_KIND.TABLE;
      header: MarkdownInline[][];
      alignments: MarkdownTableAlignment[];
      rows: MarkdownInline[][][];
    }
  | { kind: typeof MARKDOWN_BLOCK_KIND.RULE };

/** Reference definitions (`[label]: destination`), keyed by their folded label. */
type ReferenceDefinitions = ReadonlyMap<string, string>;

interface ReferenceScan {
  /** The source's lines with every definition line taken out. */
  lines: string[];
  references: ReferenceDefinitions;
}

interface ListRead {
  block: MarkdownBlock;
  /** The index of the first line after the list. */
  end: number;
}

/** A message's words as the blocks that draw them; only an entirely blank message yields none. */
export function parseMarkdown(text: string): MarkdownBlock[] {
  const { lines, references } = collectReferences(text.replace(/\r\n?/g, "\n").split("\n"));
  const blocks = parseBlocks(lines, references);
  if (blocks.length > 0) return blocks;
  const words = text.trim();
  return words === "" ? [] : [paragraph([{ kind: MARKDOWN_INLINE_KIND.TEXT, text: words }])];
}

/** The words alone, every style and structure dropped: what a reader hears. */
export function plainWords(inlines: readonly MarkdownInline[]): string {
  let words = "";
  for (const inline of inlines) {
    switch (inline.kind) {
      case MARKDOWN_INLINE_KIND.TEXT:
        words += inline.text;
        break;
      case MARKDOWN_INLINE_KIND.CODE:
        words += inline.code;
        break;
      case MARKDOWN_INLINE_KIND.BREAK:
        words += "\n";
        break;
      case MARKDOWN_INLINE_KIND.STRONG:
      case MARKDOWN_INLINE_KIND.EMPHASIS:
      case MARKDOWN_INLINE_KIND.STRIKETHROUGH:
      case MARKDOWN_INLINE_KIND.LINK:
        words += plainWords(inline.inlines);
        break;
    }
  }
  return words;
}

function paragraph(inlines: MarkdownInline[]): MarkdownBlock {
  return { kind: MARKDOWN_BLOCK_KIND.PARAGRAPH, inlines };
}

// Block structure ------------------------------------------------------------

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCK_QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^( {0,3})(?:([-+*])|(\d{1,9})([.)]))( {1,4}|\t|$)/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const TABLE_DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const REFERENCE_DEFINITION =
  /^ {0,3}\[((?:[^\]\\]|\\.){1,999})\]:[ \t]*(?:<([^>]*)>|(\S+))(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const TASK_BOX = /^\[( |x|X)\] (?=\S)/;

interface ListMarker {
  indent: number;
  ordered: boolean;
  /** `-`, `+`, `*` for a bullet; `.` or `)` for a number, so two lists differ by their marks. */
  delimiter: string;
  ordinal: number;
  /** Where the item's own content begins on its first line. */
  contentIndent: number;
  content: string;
}

function readListMarker(line: string): ListMarker | undefined {
  const match = LIST_ITEM.exec(line);
  if (!match) return undefined;
  const indent = match[1]?.length ?? 0;
  const bullet = match[2];
  const number = match[3];
  const markerLength = bullet === undefined ? (number?.length ?? 0) + 1 : 1;
  const afterMarker = indent + markerLength;
  let spaces = 0;
  while (line.charAt(afterMarker + spaces) === " ") spaces += 1;
  // Five or more spaces after the marker start an indented code block inside
  // the item, so the content column is one space past the marker in that
  // case, as it is when the marker ends the line or a tab follows it.
  const gap = spaces === 0 || spaces > 4 ? 1 : spaces;
  return {
    indent,
    ordered: bullet === undefined,
    delimiter: bullet ?? match[4] ?? "",
    ordinal: number === undefined ? 0 : Number.parseInt(number, 10),
    contentIndent: afterMarker + gap,
    content: line.slice(afterMarker + gap),
  };
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function leadingSpaces(line: string): number {
  let count = 0;
  for (const character of line) {
    if (character === " ") count += 1;
    else if (character === "\t") count += 4;
    else break;
  }
  return count;
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const header = lines[index] ?? "";
  const delimiter = lines[index + 1] ?? "";
  if (!header.includes("|") || !TABLE_DELIMITER_ROW.test(delimiter)) return false;
  return splitTableCells(header).length === splitTableCells(delimiter).length;
}

/**
 * Whether a line begins a block that cuts a paragraph short. An indented line
 * never does: inside a paragraph it is a continuation, not code. An ordered
 * item interrupts only when it starts at 1, so a sentence ending in a year
 * on its own line does not become a list.
 */
function interruptsParagraph(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (isBlank(line)) return true;
  if (HEADING.test(line) || FENCE_OPEN.test(line) || THEMATIC_BREAK.test(line)) return true;
  if (BLOCK_QUOTE.test(line)) return true;
  if (isTableStart(lines, index)) return true;
  const marker = readListMarker(line);
  if (marker && marker.content.trim() !== "" && (!marker.ordered || marker.ordinal === 1)) {
    return true;
  }
  return false;
}

/**
 * Reference definitions are read out of the text before its blocks are, so a
 * link can point at a definition written below it. Fenced code is skipped:
 * a definition quoted inside a code block is code.
 */
function collectReferences(source: readonly string[]): ReferenceScan {
  const references = new Map<string, string>();
  const lines: string[] = [];
  let fence: { mark: string; length: number } | undefined;
  for (const line of source) {
    if (fence) {
      lines.push(line);
      if (closesFence(line, fence)) fence = undefined;
      continue;
    }
    const opening = FENCE_OPEN.exec(line);
    if (opening) {
      const mark = opening[1] ?? "```";
      fence = { mark: mark.charAt(0), length: mark.length };
      lines.push(line);
      continue;
    }
    const definition = REFERENCE_DEFINITION.exec(line);
    if (definition) {
      const label = foldLabel(definition[1] ?? "");
      const destination = definition[2] ?? definition[3] ?? "";
      if (label !== "" && !references.has(label)) references.set(label, destination);
      continue;
    }
    lines.push(line);
  }
  return { lines, references };
}

function foldLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function closesFence(line: string, fence: { mark: string; length: number }): boolean {
  const trimmed = line.trim();
  if (leadingSpaces(line) > 3 || trimmed === "") return false;
  return (
    trimmed.length >= fence.length && [...trimmed].every((character) => character === fence.mark)
  );
}

function parseBlocks(lines: readonly string[], references: ReferenceDefinitions): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fenceOpening = FENCE_OPEN.exec(line);
    if (fenceOpening) {
      const mark = fenceOpening[1] ?? "```";
      const fence = { mark: mark.charAt(0), length: mark.length };
      const fenceIndent = leadingSpaces(line);
      const language = fenceOpening[2] ?? "";
      const code: string[] = [];
      index += 1;
      while (index < lines.length) {
        const codeLine = lines[index] ?? "";
        index += 1;
        if (closesFence(codeLine, fence)) break;
        code.push(removeIndent(codeLine, fenceIndent));
      }
      const block: MarkdownBlock = { kind: MARKDOWN_BLOCK_KIND.CODE, code: code.join("\n") };
      if (language !== "") block.language = language;
      blocks.push(block);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: MARKDOWN_BLOCK_KIND.HEADING,
        level: heading[1]?.length ?? 1,
        inlines: parseInlines((heading[2] ?? "").trim(), references),
      });
      index += 1;
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ kind: MARKDOWN_BLOCK_KIND.RULE });
      index += 1;
      continue;
    }

    if (INDENTED_CODE.test(line)) {
      const code: string[] = [];
      while (index < lines.length) {
        const codeLine = lines[index] ?? "";
        if (!isBlank(codeLine) && !INDENTED_CODE.test(codeLine)) break;
        code.push(isBlank(codeLine) ? "" : removeIndent(codeLine, 4));
        index += 1;
      }
      while (code.length > 0 && code[code.length - 1] === "") code.pop();
      blocks.push({ kind: MARKDOWN_BLOCK_KIND.CODE, code: code.join("\n") });
      continue;
    }

    if (BLOCK_QUOTE.test(line)) {
      const inner: string[] = [];
      while (index < lines.length) {
        const quoteLine = lines[index] ?? "";
        if (BLOCK_QUOTE.test(quoteLine)) {
          inner.push(quoteLine.replace(/^ {0,3}> ?/, ""));
          index += 1;
          continue;
        }
        // A line without the mark still belongs to the quote while it reads
        // as the paragraph before it continuing.
        const last = inner[inner.length - 1];
        if (last === undefined || isBlank(last) || interruptsParagraph(lines, index)) break;
        inner.push(quoteLine);
        index += 1;
      }
      blocks.push({ kind: MARKDOWN_BLOCK_KIND.QUOTE, blocks: parseBlocks(inner, references) });
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitTableCells(lines[index] ?? "").map((cell) =>
        parseInlines(cell, references),
      );
      const alignments = splitTableCells(lines[index + 1] ?? "").map(readAlignment);
      const rows: MarkdownInline[][][] = [];
      index += 2;
      while (index < lines.length) {
        const rowLine = lines[index] ?? "";
        if (isBlank(rowLine) || !rowLine.includes("|") || interruptsTable(rowLine)) break;
        const cells = splitTableCells(rowLine).slice(0, header.length);
        while (cells.length < header.length) cells.push("");
        rows.push(cells.map((cell) => parseInlines(cell, references)));
        index += 1;
      }
      blocks.push({ kind: MARKDOWN_BLOCK_KIND.TABLE, header, alignments, rows });
      continue;
    }

    const marker = readListMarker(line);
    if (marker) {
      const list = readList(lines, index, marker, references);
      blocks.push(list.block);
      index = list.end;
      continue;
    }

    const words: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && !interruptsParagraph(lines, index)) {
      words.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push(paragraph(parseInlines(words.join("\n"), references)));
  }
  return blocks;
}

function interruptsTable(line: string): boolean {
  return (
    HEADING.test(line) ||
    FENCE_OPEN.test(line) ||
    THEMATIC_BREAK.test(line) ||
    BLOCK_QUOTE.test(line) ||
    readListMarker(line) !== undefined
  );
}

function removeIndent(line: string, columns: number): string {
  let removed = 0;
  let index = 0;
  while (index < line.length && removed < columns) {
    const character = line.charAt(index);
    if (character === " ") removed += 1;
    else if (character === "\t") removed += 4;
    else break;
    index += 1;
  }
  return line.slice(index);
}

function readList(
  lines: readonly string[],
  start: number,
  first: ListMarker,
  references: ReferenceDefinitions,
): ListRead {
  const items: MarkdownListItem[] = [];
  let index = start;
  const startOrdinal = first.ordered ? first.ordinal : 1;
  while (index < lines.length) {
    // Blank lines between items are the list's own only if another item
    // follows them; otherwise they stay for whatever comes next to read.
    const filled = nextFilled(lines, index);
    if (filled === undefined) break;
    const marker = readListMarker(lines[filled] ?? "");
    if (!marker || !sameList(marker, first)) break;
    index = filled;
    const content: string[] = [marker.content];
    index += 1;
    while (index < lines.length) {
      const line = lines[index] ?? "";
      if (isBlank(line)) {
        // A blank line inside an item is kept only while the item goes on
        // below it; blanks that turn out to end the item are dropped with it.
        const next = nextFilled(lines, index);
        if (next === undefined || leadingSpaces(lines[next] ?? "") < marker.contentIndent) break;
        content.push("");
        index += 1;
        continue;
      }
      if (leadingSpaces(line) >= marker.contentIndent) {
        content.push(removeIndent(line, marker.contentIndent));
        index += 1;
        continue;
      }
      const last = content[content.length - 1];
      const sibling = readListMarker(line);
      if (
        last === undefined ||
        isBlank(last) ||
        (sibling !== undefined && sameList(sibling, first)) ||
        interruptsParagraph(lines, index)
      ) {
        break;
      }
      content.push(line.trim());
      index += 1;
    }
    items.push(readTaskBox(startOrdinal + items.length, content, references));
  }
  return { block: { kind: MARKDOWN_BLOCK_KIND.LIST, ordered: first.ordered, items }, end: index };
}

/** Whether a marker starts another item of the list `first` opened, rather than a nested or different one. */
function sameList(marker: ListMarker, first: ListMarker): boolean {
  return (
    marker.ordered === first.ordered &&
    marker.delimiter === first.delimiter &&
    marker.indent < first.contentIndent
  );
}

function nextFilled(lines: readonly string[], from: number): number | undefined {
  for (let index = from; index < lines.length; index += 1) {
    if (!isBlank(lines[index] ?? "")) return index;
  }
  return undefined;
}

/**
 * An item read for the task box GitHub-flavored lists open with: the box
 * leaves the words and becomes `checked`. Read from the raw first line, before
 * inline markup is applied, so a box that opens inside a code span, emphasis,
 * or link never matches — those lines begin with the markup's own character.
 */
function readTaskBox(
  ordinal: number,
  content: string[],
  references: ReferenceDefinitions,
): MarkdownListItem {
  const opening = content[0] ?? "";
  const box = TASK_BOX.exec(opening);
  if (!box) return { ordinal, blocks: parseBlocks(content, references) };
  const rest = [opening.slice(box[0].length), ...content.slice(1)];
  return {
    ordinal,
    checked: box[1] !== " ",
    blocks: parseBlocks(rest, references),
  };
}

function splitTableCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  let backticks = 0;
  for (const character of trimmed) {
    if (escaped) {
      cell += character === "|" ? "|" : `\\${character}`;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "`") {
      backticks += 1;
    } else if (character === "|" && backticks % 2 === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}

function readAlignment(cell: string): MarkdownTableAlignment {
  const leading = cell.startsWith(":");
  const trailing = cell.endsWith(":");
  if (leading && trailing) return MARKDOWN_TABLE_ALIGNMENT.CENTER;
  if (trailing) return MARKDOWN_TABLE_ALIGNMENT.TRAILING;
  return MARKDOWN_TABLE_ALIGNMENT.LEADING;
}

// Inline structure -----------------------------------------------------------

const DELIMITER_CHARACTERS = new Set(["*", "_", "~"]);
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;
const AUTOLINK = /^<(https?:\/\/[^\s<>]+)>/i;
const BARE_URL = /^https?:\/\/[^\s<]+/i;
const LINK_DESTINATION_ANGLE = /^<([^<>\n]*)>/;
const LINK_TITLE = /^(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))/;
const SAFE_LINK_SCHEME = /^https?:\/\//i;

type InlineToken =
  | { kind: "node"; node: MarkdownInline }
  | {
      kind: "delimiter";
      character: string;
      count: number;
      originalCount: number;
      canOpen: boolean;
      canClose: boolean;
    };

function isWhitespace(character: string): boolean {
  return character === "" || /\s/u.test(character);
}

function isPunctuation(character: string): boolean {
  return ASCII_PUNCTUATION.test(character) || UNICODE_PUNCTUATION.test(character);
}

function parseInlines(text: string, references: ReferenceDefinitions): MarkdownInline[] {
  const tokens = tokenizeInlines(text, references);
  return processEmphasis(tokens);
}

function tokenizeInlines(text: string, references: ReferenceDefinitions): InlineToken[] {
  const tokens: InlineToken[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer === "") return;
    tokens.push({ kind: "node", node: { kind: MARKDOWN_INLINE_KIND.TEXT, text: buffer } });
    buffer = "";
  };
  let index = 0;
  while (index < text.length) {
    const character = text.charAt(index);

    if (character === "\\") {
      const next = text.charAt(index + 1);
      if (next === "\n") {
        flush();
        tokens.push({ kind: "node", node: { kind: MARKDOWN_INLINE_KIND.BREAK } });
        index += 2;
        continue;
      }
      if (next !== "" && ASCII_PUNCTUATION.test(next)) {
        buffer += next;
        index += 2;
        continue;
      }
      buffer += character;
      index += 1;
      continue;
    }

    if (character === "\n") {
      buffer = buffer.replace(/[ \t]+$/, "");
      flush();
      tokens.push({ kind: "node", node: { kind: MARKDOWN_INLINE_KIND.BREAK } });
      index += 1;
      while (text.charAt(index) === " " || text.charAt(index) === "\t") index += 1;
      continue;
    }

    if (character === "`") {
      const span = readCodeSpan(text, index);
      if (span) {
        flush();
        tokens.push({ kind: "node", node: { kind: MARKDOWN_INLINE_KIND.CODE, code: span.code } });
        index = span.end;
        continue;
      }
      const run = readRun(text, index, "`");
      buffer += run;
      index += run.length;
      continue;
    }

    if (character === "<") {
      const autolink = AUTOLINK.exec(text.slice(index));
      if (autolink) {
        const href = autolink[1] ?? "";
        flush();
        tokens.push({
          kind: "node",
          node: {
            kind: MARKDOWN_INLINE_KIND.LINK,
            href,
            inlines: [{ kind: MARKDOWN_INLINE_KIND.TEXT, text: href }],
          },
        });
        index += autolink[0].length;
        continue;
      }
    }

    if (character === "h" || character === "H") {
      const bare = BARE_URL.exec(text.slice(index));
      const previous = index === 0 ? "" : text.charAt(index - 1);
      if (
        bare &&
        (isWhitespace(previous) || previous === "(" || previous === "*" || previous === "_")
      ) {
        const href = trimBareUrl(bare[0]);
        flush();
        tokens.push({
          kind: "node",
          node: {
            kind: MARKDOWN_INLINE_KIND.LINK,
            href,
            inlines: [{ kind: MARKDOWN_INLINE_KIND.TEXT, text: href }],
          },
        });
        index += href.length;
        continue;
      }
    }

    if (character === "[" || (character === "!" && text.charAt(index + 1) === "[")) {
      const isImage = character === "!";
      const link = readLink(text, isImage ? index + 1 : index, references);
      if (link) {
        flush();
        const inner = parseInlines(link.text, references);
        // An image has no picture to draw in a caption; its alternative
        // words stand in for it, the way a screen reader would say it.
        if (isImage || !SAFE_LINK_SCHEME.test(link.href)) {
          for (const inline of inner) tokens.push({ kind: "node", node: inline });
        } else {
          tokens.push({
            kind: "node",
            node: { kind: MARKDOWN_INLINE_KIND.LINK, href: link.href, inlines: inner },
          });
        }
        index = link.end;
        continue;
      }
    }

    if (DELIMITER_CHARACTERS.has(character)) {
      const run = readRun(text, index, character);
      const before = index === 0 ? "" : text.charAt(index - 1);
      const after = text.charAt(index + run.length);
      const leftFlanking =
        !isWhitespace(after) &&
        (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
      const rightFlanking =
        !isWhitespace(before) &&
        (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
      let canOpen = leftFlanking;
      let canClose = rightFlanking;
      if (character === "_") {
        canOpen = leftFlanking && (!rightFlanking || isPunctuation(before));
        canClose = rightFlanking && (!leftFlanking || isPunctuation(after));
      }
      if (character === "~" && run.length > 2) {
        buffer += run;
        index += run.length;
        continue;
      }
      flush();
      tokens.push({
        kind: "delimiter",
        character,
        count: run.length,
        originalCount: run.length,
        canOpen,
        canClose,
      });
      index += run.length;
      continue;
    }

    buffer += character;
    index += 1;
  }
  flush();
  return tokens;
}

function readRun(text: string, start: number, character: string): string {
  let end = start;
  while (text.charAt(end) === character) end += 1;
  return text.slice(start, end);
}

function readCodeSpan(text: string, start: number): { code: string; end: number } | undefined {
  const opening = readRun(text, start, "`");
  let index = start + opening.length;
  while (index < text.length) {
    if (text.charAt(index) !== "`") {
      index += 1;
      continue;
    }
    const run = readRun(text, index, "`");
    if (run.length === opening.length) {
      let code = text.slice(start + opening.length, index).replace(/\n/g, " ");
      if (code.length >= 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") {
        code = code.slice(1, -1);
      }
      return { code, end: index + run.length };
    }
    index += run.length;
  }
  return undefined;
}

function trimBareUrl(candidate: string): string {
  let url = candidate.replace(/[.,:;!?'"*_~]+$/, "");
  while (url.endsWith(")")) {
    const opens = url.split("(").length - 1;
    const closes = url.split(")").length - 1;
    if (closes <= opens) break;
    url = url.slice(0, -1);
  }
  return url;
}

/** The link's text and destination from `[`, or nothing when the brackets do not make one. */
function readLink(
  text: string,
  start: number,
  references: ReferenceDefinitions,
): { text: string; href: string; end: number } | undefined {
  const close = matchingBracket(text, start);
  if (close === undefined) return undefined;
  const label = text.slice(start + 1, close);
  const afterLabel = close + 1;

  if (text.charAt(afterLabel) === "(") {
    const inline = readInlineDestination(text, afterLabel + 1);
    if (inline) return { text: label, href: inline.href, end: inline.end };
  }

  if (text.charAt(afterLabel) === "[") {
    const referenceClose = matchingBracket(text, afterLabel);
    if (referenceClose !== undefined) {
      const reference = text.slice(afterLabel + 1, referenceClose);
      const href = references.get(foldLabel(reference === "" ? label : reference));
      if (href !== undefined) return { text: label, href, end: referenceClose + 1 };
    }
  }

  const shortcut = references.get(foldLabel(label));
  if (shortcut !== undefined) return { text: label, href: shortcut, end: afterLabel };
  return undefined;
}

function matchingBracket(text: string, open: number): number | undefined {
  let depth = 0;
  let index = open;
  while (index < text.length) {
    const character = text.charAt(index);
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "`") {
      const span = readCodeSpan(text, index);
      index = span ? span.end : index + readRun(text, index, "`").length;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return undefined;
}

function readInlineDestination(
  text: string,
  start: number,
): { href: string; end: number } | undefined {
  let index = start;
  while (text.charAt(index) === " " || text.charAt(index) === "\n") index += 1;
  let href: string;
  const angled = LINK_DESTINATION_ANGLE.exec(text.slice(index));
  if (angled) {
    href = angled[1] ?? "";
    index += angled[0].length;
  } else {
    const destinationStart = index;
    let depth = 0;
    while (index < text.length) {
      const character = text.charAt(index);
      if (/\s/.test(character)) break;
      if (character === "\\" && index + 1 < text.length) {
        index += 2;
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      index += 1;
    }
    href = text.slice(destinationStart, index).replace(/\\([!-/:-@[-`{-~])/g, "$1");
  }
  while (text.charAt(index) === " " || text.charAt(index) === "\n") index += 1;
  const title = LINK_TITLE.exec(text.slice(index));
  if (title && index > start) {
    index += title[0].length;
    while (text.charAt(index) === " " || text.charAt(index) === "\n") index += 1;
  }
  if (text.charAt(index) !== ")") return undefined;
  return { href, end: index + 1 };
}

/**
 * CommonMark's emphasis algorithm over the delimiter runs: each closer looks
 * back for the nearest opener of its own character, wraps what stands between
 * them, and spends its delimiters two at a time for strong before one at a
 * time for emphasis. A run left over is the characters it was.
 */
function processEmphasis(tokens: InlineToken[]): MarkdownInline[] {
  let closerIndex = 0;
  while (closerIndex < tokens.length) {
    const closer = tokens[closerIndex];
    if (!closer || closer.kind !== "delimiter" || !closer.canClose) {
      closerIndex += 1;
      continue;
    }
    let openerIndex = closerIndex - 1;
    let opener: InlineToken | undefined;
    while (openerIndex >= 0) {
      const candidate = tokens[openerIndex];
      if (
        candidate &&
        candidate.kind === "delimiter" &&
        candidate.character === closer.character &&
        candidate.canOpen &&
        delimitersPair(candidate, closer)
      ) {
        opener = candidate;
        break;
      }
      openerIndex -= 1;
    }
    if (!opener || opener.kind !== "delimiter") {
      closerIndex += 1;
      continue;
    }
    const use =
      closer.character === "~" ? closer.count : opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const kind =
      closer.character === "~"
        ? MARKDOWN_INLINE_KIND.STRIKETHROUGH
        : use === 2
          ? MARKDOWN_INLINE_KIND.STRONG
          : MARKDOWN_INLINE_KIND.EMPHASIS;
    const between = tokens.slice(openerIndex + 1, closerIndex);
    const wrapped: InlineToken = {
      kind: "node",
      node: { kind, inlines: mergeText(between.map(tokenToInline)) },
    };
    opener.count -= use;
    closer.count -= use;
    const replacement: InlineToken[] = [];
    if (opener.count > 0) replacement.push(opener);
    replacement.push(wrapped);
    if (closer.count > 0) replacement.push(closer);
    tokens.splice(openerIndex, closerIndex - openerIndex + 1, ...replacement);
    closerIndex = openerIndex + replacement.length - (closer.count > 0 ? 1 : 0);
  }
  return mergeText(tokens.map(tokenToInline));
}

function delimitersPair(opener: InlineToken, closer: InlineToken): boolean {
  if (opener.kind !== "delimiter" || closer.kind !== "delimiter") return false;
  if (opener.character === "~") return opener.count === closer.count;
  // A run that could both open and close may not pair with another unless
  // their lengths add to a multiple of three only when both already are.
  if (opener.canClose || closer.canOpen) {
    const sum = opener.originalCount + closer.originalCount;
    if (sum % 3 === 0 && (opener.originalCount % 3 !== 0 || closer.originalCount % 3 !== 0)) {
      return false;
    }
  }
  return true;
}

function tokenToInline(token: InlineToken): MarkdownInline {
  if (token.kind === "node") return token.node;
  return { kind: MARKDOWN_INLINE_KIND.TEXT, text: token.character.repeat(token.count) };
}

function mergeText(inlines: readonly MarkdownInline[]): MarkdownInline[] {
  const merged: MarkdownInline[] = [];
  for (const inline of inlines) {
    const last = merged[merged.length - 1];
    if (
      inline.kind === MARKDOWN_INLINE_KIND.TEXT &&
      last &&
      last.kind === MARKDOWN_INLINE_KIND.TEXT
    ) {
      merged[merged.length - 1] = {
        kind: MARKDOWN_INLINE_KIND.TEXT,
        text: last.text + inline.text,
      };
      continue;
    }
    merged.push(inline);
  }
  return merged;
}
