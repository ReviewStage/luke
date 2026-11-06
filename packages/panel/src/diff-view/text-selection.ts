import { DIFF_SELECTION_SIDE, type DiffSelection, type DiffTextRect } from "./contract.js";

export type RangeEnds = Pick<
  AbstractRange,
  "startContainer" | "startOffset" | "endContainer" | "endOffset"
>;

const ROW = "[data-line]";
const OLD_COLUMN = "[data-deletions]";
const COLUMN = "[data-code]";

const CHANGED_SIDE = new Map([
  ["change-deletion", DIFF_SELECTION_SIDE.DELETIONS],
  ["change-addition", DIFF_SELECTION_SIDE.ADDITIONS],
]);

function rowOf(node: Node): Element | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(ROW) ?? undefined;
}

function rowBefore(row: Element): Element | undefined {
  const column = row.closest(COLUMN) ?? row.parentElement;
  const rows = column === null ? [] : [...column.querySelectorAll(ROW)];
  const at = rows.indexOf(row);
  return at > 0 ? rows[at - 1] : undefined;
}

function lineOf(row: Element): { line: number; side: DiffSelection["side"] } | undefined {
  const line = Number(row.getAttribute("data-line"));
  if (!Number.isInteger(line) || line < 1) return undefined;
  const changed = CHANGED_SIDE.get(row.getAttribute("data-line-type") ?? "");
  const side =
    changed ??
    (row.closest(OLD_COLUMN) === null
      ? DIFF_SELECTION_SIDE.ADDITIONS
      : DIFF_SELECTION_SIDE.DELETIONS);
  return { line, side };
}

export function pressedOnCode(path: readonly EventTarget[]): boolean {
  return path.some((target) => target instanceof Element && target.matches(COLUMN));
}

export function selectedLines(range: RangeEnds): DiffSelection | undefined {
  const firstRow = rowOf(range.startContainer);
  const endRow = rowOf(range.endContainer);
  if (firstRow === undefined || endRow === undefined) return undefined;
  const lastRow =
    range.endOffset === 0 && endRow !== firstRow ? (rowBefore(endRow) ?? firstRow) : endRow;
  const first = lineOf(firstRow);
  const last = lineOf(lastRow);
  if (first === undefined || last === undefined) return undefined;
  return { start: first.line, side: first.side, end: last.line, endSide: last.side };
}

export function selectionRect(range: Range): DiffTextRect | undefined {
  const row = rowOf(range.startContainer);
  const rowWidth = row?.getBoundingClientRect().width;
  const boxes = [...range.getClientRects()].filter(
    (box) =>
      (box.width > 0 || box.height > 0) &&
      (rowWidth === undefined || Math.abs(box.width - rowWidth) >= 1),
  );
  if (boxes.length === 0) return undefined;
  return {
    top: Math.min(...boxes.map((box) => box.top)),
    left: Math.min(...boxes.map((box) => box.left)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
}
