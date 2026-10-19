/**
 * markdown-edits.ts -- what each press of a comment field's formatting toolbar writes into its words, and what it leaves selected, as GitHub's own comment toolbar writes them.
 *
 * Each format is one edit of the words as they stand: the span it replaces,
 * the words it puts there, and the span it selects afterwards, so the field
 * can make it as one insertion its own undo takes back (`markdown-toolbar.tsx`).
 * A press wraps what is selected, or, with nothing selected, writes a word
 * standing for what goes there and selects it, so typing replaces it. A
 * wrap pressed again over what it wrapped takes it off, and a line prefix
 * pressed over lines that all wear it takes it off them, as GitHub's own
 * toolbar toggles. Code over more than one line is a fenced block rather
 * than a span, as GitHub writes it. A suggestion is a fenced block of its
 * own (`suggestionEdit`), holding the lines it would change as they read
 * now, so the member edits them into what they should read; its fence is
 * longer than any run of backticks in those lines, so code holding a fence
 * of its own stays inside it.
 */

/** The formats the toolbar offers, in the order it draws them. */
export const MARKDOWN_FORMAT = {
  HEADING: "heading",
  BOLD: "bold",
  ITALIC: "italic",
  QUOTE: "quote",
  CODE: "code",
  LINK: "link",
  BULLETS: "bullets",
  NUMBERS: "numbers",
  TASKS: "tasks",
} as const;

export type MarkdownFormat = (typeof MARKDOWN_FORMAT)[keyof typeof MARKDOWN_FORMAT];

/** A field's words and the span selected in them, a caret where both ends are one. */
export interface FieldSelection {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/** One edit: the words from `from` to `to` replaced by `text`, then `selectFrom` to `selectTo` selected in the words that result. */
export interface MarkdownEdit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly selectFrom: number;
  readonly selectTo: number;
}

/** What a wrap with nothing selected writes between its marks. */
const PLACEHOLDER = {
  HEADING: "Heading",
  BOLD: "bold text",
  ITALIC: "italic text",
  QUOTE: "Quote",
  CODE: "code",
  LINK_TEXT: "link text",
  LINK_URL: "url",
  LIST_ITEM: "List item",
  TASK: "Task",
} as const;

/** How a line prefix is written on each line, and how one already written is read. */
interface LinePrefix {
  readonly write: (index: number) => string;
  readonly worn: RegExp;
  readonly placeholder: string;
}

/** Each line format's prefix. Note that a bulleted line is told from a task by what follows its dash, so a list of tasks is never read as bulleted. */
const LINE_PREFIX = {
  HEADING: { write: () => "### ", worn: /^#{1,6} /u, placeholder: PLACEHOLDER.HEADING },
  QUOTE: { write: () => "> ", worn: /^> ?/u, placeholder: PLACEHOLDER.QUOTE },
  BULLETS: {
    write: () => "- ",
    worn: /^[-*] (?!\[[ xX]\] )/u,
    placeholder: PLACEHOLDER.LIST_ITEM,
  },
  NUMBERS: {
    write: (index) => `${index + 1}. `,
    worn: /^\d+\. /u,
    placeholder: PLACEHOLDER.LIST_ITEM,
  },
  TASKS: { write: () => "- [ ] ", worn: /^[-*] \[[ xX]\] /u, placeholder: PLACEHOLDER.TASK },
} as const satisfies Record<string, LinePrefix>;

/** The fewest backticks a fence is written with. */
const FENCE_LEAST = 3;

/** A run of backticks. */
const BACKTICKS = /`+/gu;

/** An address a selection may be, which a link takes as where it points rather than its words. */
const ADDRESS = /^https?:\/\/\S+$/u;

/** The edit replacing the span given with `text`, selecting `select` within the words it wrote. */
function replacing(
  from: number,
  to: number,
  text: string,
  select: readonly [number, number],
): MarkdownEdit {
  return { from, to, text, selectFrom: from + select[0], selectTo: from + select[1] };
}

/**
 * Wraps the selection in `mark` on each side, or writes `placeholder`
 * between the marks and selects it. Where the selection already stands
 * between the marks, or holds them at its own ends, the marks come off.
 */
function wrapEdit(field: FieldSelection, mark: string, placeholder: string): MarkdownEdit {
  const { value, start, end } = field;
  const selected = value.slice(start, end);
  const width = mark.length;
  if (value.slice(start - width, start) === mark && value.slice(end, end + width) === mark) {
    return replacing(start - width, end + width, selected, [0, selected.length]);
  }
  if (selected.length >= 2 * width && selected.startsWith(mark) && selected.endsWith(mark)) {
    const inner = selected.slice(width, -width);
    return replacing(start, end, inner, [0, inner.length]);
  }
  const words = selected === "" ? placeholder : selected;
  return replacing(start, end, `${mark}${words}${mark}`, [width, width + words.length]);
}

/** A link: the selection as its words with the address selected, an address selected as where it points with its words selected, or both written for the member to fill. */
function linkEdit(field: FieldSelection): MarkdownEdit {
  const { value, start, end } = field;
  const selected = value.slice(start, end);
  if (ADDRESS.test(selected)) {
    const words = PLACEHOLDER.LINK_TEXT;
    return replacing(start, end, `[${words}](${selected})`, [1, 1 + words.length]);
  }
  const words = selected === "" ? PLACEHOLDER.LINK_TEXT : selected;
  const at = words.length + 3;
  return replacing(start, end, `[${words}](${PLACEHOLDER.LINK_URL})`, [
    selected === "" ? 1 : at,
    selected === "" ? 1 + words.length : at + PLACEHOLDER.LINK_URL.length,
  ]);
}

/**
 * Prefixes each line the selection touches, or takes the prefix off where
 * every one of them already wears it. A caret on an empty line writes the
 * prefix and its placeholder, selected; a caret on a line with words
 * prefixes that line and stays at its end. Note that a selection ending at
 * the very start of a line leaves that line alone, because selecting whole
 * lines by dragging ends there.
 */
function prefixEdit(field: FieldSelection, prefix: LinePrefix): MarkdownEdit {
  const { value, start, end } = field;
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", last);
  const to = lineEnd === -1 ? value.length : lineEnd;
  const lines = value.slice(from, to).split("\n");
  if (start === end && lines.length === 1 && lines[0] === "") {
    const written = prefix.write(0);
    return replacing(from, to, `${written}${prefix.placeholder}`, [
      written.length,
      written.length + prefix.placeholder.length,
    ]);
  }
  const worn = lines.every((line) => prefix.worn.test(line));
  const text = lines
    .map((line, index) => (worn ? line.replace(prefix.worn, "") : `${prefix.write(index)}${line}`))
    .join("\n");
  return replacing(from, to, text, start === end ? [text.length, text.length] : [0, text.length]);
}

/** The fence a block holding `content` is written with: longer than any run of backticks in it, and never shorter than three. */
function fenceFor(content: string): string {
  const longest = Math.max(0, ...[...content.matchAll(BACKTICKS)].map(([run]) => run.length));
  return "`".repeat(Math.max(FENCE_LEAST, longest + 1));
}

/**
 * A fenced block, its opening fence naming `info`, holding `body`, put in
 * place of the span given on lines of its own, with its body selected.
 */
function blockEdit(
  value: string,
  from: number,
  to: number,
  info: string,
  body: string,
): MarkdownEdit {
  const fence = fenceFor(body);
  const lead = from > 0 && value[from - 1] !== "\n" ? "\n" : "";
  const trail = to < value.length && value[to] !== "\n" ? "\n" : "";
  const opening = `${lead}${fence}${info}\n`;
  return replacing(from, to, `${opening}${body}\n${fence}${trail}`, [
    opening.length,
    opening.length + body.length,
  ]);
}

/** Code: a span around a selection on one line, or a fenced block around one over several. */
function codeEdit(field: FieldSelection): MarkdownEdit {
  const { value, start, end } = field;
  const selected = value.slice(start, end);
  if (!selected.includes("\n")) return wrapEdit(field, "`", PLACEHOLDER.CODE);
  // Note that a selection of whole lines ends on a newline, which the fence's own line stands for.
  return blockEdit(
    value,
    start,
    end,
    "",
    selected.endsWith("\n") ? selected.slice(0, -1) : selected,
  );
}

/** The edit a press of `format` makes to the field as it stands. */
export function markdownEdit(format: MarkdownFormat, field: FieldSelection): MarkdownEdit {
  switch (format) {
    case MARKDOWN_FORMAT.HEADING:
      return prefixEdit(field, LINE_PREFIX.HEADING);
    case MARKDOWN_FORMAT.BOLD:
      return wrapEdit(field, "**", PLACEHOLDER.BOLD);
    case MARKDOWN_FORMAT.ITALIC:
      return wrapEdit(field, "_", PLACEHOLDER.ITALIC);
    case MARKDOWN_FORMAT.QUOTE:
      return prefixEdit(field, LINE_PREFIX.QUOTE);
    case MARKDOWN_FORMAT.CODE:
      return codeEdit(field);
    case MARKDOWN_FORMAT.LINK:
      return linkEdit(field);
    case MARKDOWN_FORMAT.BULLETS:
      return prefixEdit(field, LINE_PREFIX.BULLETS);
    case MARKDOWN_FORMAT.NUMBERS:
      return prefixEdit(field, LINE_PREFIX.NUMBERS);
    case MARKDOWN_FORMAT.TASKS:
      return prefixEdit(field, LINE_PREFIX.TASKS);
  }
}

/**
 * A suggestion block holding `lines` as they read now, written on lines of
 * its own after the line the selection ends on, so nothing written is lost
 * or split, with the lines selected for the member to change.
 */
export function suggestionEdit(field: FieldSelection, lines: string): MarkdownEdit {
  const lineEnd = field.value.indexOf("\n", field.end);
  const at = lineEnd === -1 ? field.value.length : lineEnd;
  return blockEdit(field.value, at, at, "suggestion", lines);
}
