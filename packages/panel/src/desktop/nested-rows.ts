/**
 * nested-rows.ts -- a sidebar list's rows with child tasks nested under their parents, held steady while they stand as they did, and the fold a parent's row draws over them.
 *
 * Every list of the sidebar's tasks, Tasks' groups and the account's
 * sections alike, draws its rows through `drawnTaskRows`, so a child task
 * stands under its parent wherever both stand in one list and at the top
 * where its parent stands elsewhere or nowhere. The rows a list draws are
 * handed to `useLeaving`, which takes a list handed anew as a list changed,
 * so they are handed back as the same list for as long as each row stands
 * where it stood, at the same depth and fold.
 *
 * A list whose rows the reader orders, an account's section, keeps them in
 * an order of its own, which nesting redraws: a child stands under its
 * parent wherever its entry stands. So a move is made among a row's
 * siblings as they are drawn, the rows under the same parent or at the
 * top, and lands its entry beside the sibling's, which is all that orders
 * them; and a row let go at a slot lands before the row at the top drawn
 * after it, never inside another's child tasks.
 */

import type { ListRowFold } from "@luke/ui";
import { type DrawnTaskRow, drawnTaskRows, TASK_ROW, type TaskRow } from "@luke/ui/task-list-model";
import { useRef } from "react";

/** The words a parent's fold is named by, before its name. */
const CHILD_TASKS_OF = "Child tasks of";

/** Whether two drawings stand every row alike: the same row, at the same depth, folded the same way. */
function sameDrawn(was: readonly DrawnTaskRow[], now: readonly DrawnTaskRow[]): boolean {
  return (
    was.length === now.length &&
    was.every((held, at) => {
      const next = now[at];
      return (
        next !== undefined &&
        next.row === held.row &&
        next.depth === held.depth &&
        next.open === held.open
      );
    })
  );
}

/** For each drawn row, the index of the row it stands nested under; -1 for a row at the top. */
function parentsOf(nested: readonly DrawnTaskRow[]): number[] {
  const above: number[] = [];
  return nested.map(({ depth }, at) => {
    const parent = depth === 0 ? -1 : (above[depth - 1] ?? -1);
    above[depth] = at;
    above.length = depth + 1;
    return parent;
  });
}

/** The drawn rows standing beside the one at `at`, itself among them: those nested under the same parent, or at the top, by their index among the drawn. */
export function siblingsAt(nested: readonly DrawnTaskRow[], at: number): number[] {
  const parents = parentsOf(nested);
  const parent = parents[at];
  return nested.flatMap((_, each) => (parents[each] === parent ? [each] : []));
}

/**
 * The drawn row a move of the row at `from` toward the slot `to` lands
 * beside: the sibling whose rows `to` falls among, or, where that is the
 * row's own, the next sibling down; none where the move would carry it out
 * from under its parent, or past its last sibling.
 */
export function movedBeside(
  nested: readonly DrawnTaskRow[],
  from: number,
  to: number,
): number | undefined {
  const siblings = siblingsAt(nested, from);
  const own = siblings.indexOf(from);
  const reached = siblings.findLastIndex((each) => each <= to);
  if (reached < 0) return undefined;
  const beside = reached === own && to > from ? own + 1 : reached;
  return beside === own ? undefined : siblings[beside];
}

/** Where a row let go at the drawn slot `at` lands in `rows`, the order the list keeps: before the row at the top drawn next, or last where none is. */
export function storedSlot(
  rows: readonly TaskRow[],
  nested: readonly DrawnTaskRow[],
  at: number,
): number {
  const next = nested.slice(at).find(({ depth }) => depth === 0);
  return next === undefined ? rows.length : rows.indexOf(next.row);
}

/** The fold a task's row draws over the child tasks nested under it, asking `onFold` to turn it; none where the list nests none under it. */
export function childTasksFold(
  drawn: DrawnTaskRow,
  onFold: (taskId: string) => void,
): ListRowFold | undefined {
  const { row, open } = drawn;
  if (open === undefined || row.kind !== TASK_ROW.TASK) return undefined;
  return {
    open,
    onOpenChange: (asked) => {
      if (asked !== open) onFold(row.task.id);
    },
    label: `${CHILD_TASKS_OF} ${row.task.name}`,
  };
}

/** The rows a list draws (`drawnTaskRows`), the same list across renders while every row stands as it did. */
export function useNestedRows(
  rows: readonly TaskRow[],
  opened: (taskId: string) => boolean,
  standing: (row: TaskRow) => boolean,
): readonly DrawnTaskRow[] {
  const drawn = drawnTaskRows(rows, opened, standing);
  const held = useRef(drawn);
  // Note that the ref follows the drawing as it renders, so a list that changed is handed on the same frame.
  if (!sameDrawn(held.current, drawn)) held.current = drawn;
  return held.current;
}
