/**
 * line-indents.ts -- each drawn line's leading indent, written on its row, so a wrapped line's later rows stand under its code rather than back at the column's start.
 *
 * Pierre wraps a long line at the code column's edge, and every row after
 * its first starts at the column's own start, so the rest of a nested line
 * reads as if it were outdented. A stylesheet cannot measure a line's
 * leading whitespace, so each line drawn is marked here with its width in
 * columns (`LINE_INDENT_PROPERTY`), as the file is drawn; the look's sheet
 * hangs a wrapped line's later rows by it (`index.ts`'s `LOOK_CSS`). A line
 * with no indent wears no mark.
 */

/** The custom property a line's row wears: its leading whitespace's width, in `ch`. */
const LINE_INDENT_PROPERTY = "--luke-line-indent";

/** A line's leading run of spaces and tabs. */
const LEADING_WHITESPACE = /^[ \t]*/;

/** The tab width a line is measured by where its style names none it can read. */
const DEFAULT_TAB_SIZE = 8;

/** The width of `text`'s leading whitespace in columns, a tab reaching the next stop `tabSize` columns apart. */
function indentColumns(text: string, tabSize: number): number {
  let columns = 0;
  for (const character of LEADING_WHITESPACE.exec(text)?.[0] ?? "") {
    columns = character === "\t" ? columns + tabSize - (columns % tabSize) : columns + 1;
  }
  return columns;
}

/**
 * Marks every line drawn in a file's shadow root with its indent, or takes
 * the mark off a line Pierre drew again with none. The tab width is read
 * once, off the first line, since Pierre sets one for the whole file.
 */
export function markLineIndents(root: ParentNode): void {
  const lines = root.querySelectorAll<HTMLElement>("[data-line]");
  const first = lines[0];
  if (first === undefined) return;
  const tabSize = Number.parseInt(getComputedStyle(first).tabSize, 10) || DEFAULT_TAB_SIZE;
  for (const line of lines) {
    const columns = indentColumns(line.textContent ?? "", tabSize);
    if (columns === 0) line.style.removeProperty(LINE_INDENT_PROPERTY);
    else line.style.setProperty(LINE_INDENT_PROPERTY, `${columns}ch`);
  }
}
