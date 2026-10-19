import { DIFF_SELECTION_SIDE, type DiffSelection, type DiffTextRect } from "./contract.js";

/**
 * text-selection.ts -- code selected as text in a file Pierre drew, read as the lines it runs over and where it stands, so the view can offer a comment on them.
 *
 * Pierre writes each line of code as a row naming its number
 * (`data-line`) and its kind (`data-line-type`): a removed line counts on
 * the old side and an added line on the new, and an unchanged line on the
 * side of the column it stands in, the old side's in a split diff's left
 * column and the new side's anywhere else, as Pierre's own picking reads
 * them. A selection's ends are read from the rows they stand in; one whose
 * end stands outside every row, in a note under a line or past the code,
 * runs over no lines. A drag that ends at the very start of a row, as a
 * triple-click's does, ends on the row before it, found in the column
 * rather than counted, since the row before may stand across a gap.
 */

/** The ends of a selection's range, as a live range and a static one both have them. */
export type RangeEnds = Pick<
  AbstractRange,
  "startContainer" | "startOffset" | "endContainer" | "endOffset"
>;

/** What marks a row of code, and the column of a split diff that counts on the old side. */
const ROW = "[data-line]";
const OLD_COLUMN = "[data-deletions]";
const COLUMN = "[data-code]";

/** Each kind of changed row and the side it counts on whatever column it stands in. */
const CHANGED_SIDE = new Map([
  ["change-deletion", DIFF_SELECTION_SIDE.DELETIONS],
  ["change-addition", DIFF_SELECTION_SIDE.ADDITIONS],
]);

/** The row of code a node stands in, none outside every row. */
function rowOf(node: Node): Element | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(ROW) ?? undefined;
}

/** The row before `row` in its column, none for the column's first. */
function rowBefore(row: Element): Element | undefined {
  const column = row.closest(COLUMN) ?? row.parentElement;
  const rows = column === null ? [] : [...column.querySelectorAll(ROW)];
  const at = rows.indexOf(row);
  return at > 0 ? rows[at - 1] : undefined;
}

/** A row's number and the side it counts on; none where it names no number. */
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

/** The lines a selection of code runs over, from its first row to its last; none where an end stands outside every row. */
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

/**
 * Where a selection's words stand in the window: the box around them,
 * leaving out the boxes a whole row draws for a selection that runs past
 * its end, so the box is the words' own; none where it draws nothing.
 */
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
