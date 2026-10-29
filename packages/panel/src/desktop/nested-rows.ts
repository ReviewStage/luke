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
