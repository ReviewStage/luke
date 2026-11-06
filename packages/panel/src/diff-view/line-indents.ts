const LINE_INDENT_PROPERTY = "--ui-line-indent";

const LEADING_WHITESPACE = /^[ \t]*/;

const DEFAULT_TAB_SIZE = 8;

function indentColumns(text: string, tabSize: number): number {
  let columns = 0;
  for (const character of LEADING_WHITESPACE.exec(text)?.[0] ?? "") {
    columns = character === "\t" ? columns + tabSize - (columns % tabSize) : columns + 1;
  }
  return columns;
}

const TAB_SIZES = new WeakMap<ParentNode, number>();

function tabSizeOf(root: ParentNode, first: HTMLElement): number {
  const kept = TAB_SIZES.get(root);
  if (kept !== undefined) return kept;
  const tabSize = Number.parseInt(getComputedStyle(first).tabSize, 10) || DEFAULT_TAB_SIZE;
  TAB_SIZES.set(root, tabSize);
  return tabSize;
}

export function markLineIndents(root: ParentNode): void {
  const lines = root.querySelectorAll<HTMLElement>("[data-line]");
  const first = lines[0];
  if (first === undefined) return;
  const tabSize = tabSizeOf(root, first);
  for (const line of lines) {
    const columns = indentColumns(line.textContent ?? "", tabSize);
    const mark = columns === 0 ? "" : `${columns}ch`;
    if (line.style.getPropertyValue(LINE_INDENT_PROPERTY) === mark) continue;
    if (mark === "") line.style.removeProperty(LINE_INDENT_PROPERTY);
    else line.style.setProperty(LINE_INDENT_PROPERTY, mark);
  }
}
