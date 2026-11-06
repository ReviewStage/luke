import type { ListRowFold, ListRowNest } from "@repo/ui";
import { type DrawnTaskRow, drawnTaskRows, TASK_ROW, type TaskRow } from "@repo/ui/task-list-model";
import { useRef } from "react";

const CHILD_TASKS_OF = "Sub-tasks of";

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

type Depth = Pick<DrawnTaskRow, "depth">;

function parentsOf(nested: readonly Depth[]): number[] {
  const above: number[] = [];
  return nested.map(({ depth }, at) => {
    const parent = depth === 0 ? -1 : (above[depth - 1] ?? -1);
    above[depth] = at;
    above.length = depth + 1;
    return parent;
  });
}

export function siblingsAt(nested: readonly Depth[], at: number): number[] {
  const parents = parentsOf(nested);
  const parent = parents[at];
  return nested.flatMap((_, each) => (parents[each] === parent ? [each] : []));
}

export function nestsOf(nested: readonly Depth[]): (ListRowNest | undefined)[] {
  if (nested.every(({ depth }) => depth === 0)) return nested.map(() => undefined);
  const parents = parentsOf(nested);
  const sizes = new Map<number, number>();
  const positions = parents.map((parent) => {
    const position = (sizes.get(parent) ?? 0) + 1;
    sizes.set(parent, position);
    return position;
  });
  return parents.map((parent, at) => ({
    position: positions[at] ?? 1,
    size: sizes.get(parent) ?? 1,
  }));
}

export function listedSlot(
  drawn: readonly { readonly leaving: boolean }[],
  from: number,
  to: number,
): number {
  const before = to > from ? drawn.slice(0, to + 1) : drawn.slice(0, to);
  return before.filter((entry, at) => !entry.leaving && at !== from).length;
}

export function movedBeside(
  nested: readonly Depth[],
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

export function storedSlot(
  rows: readonly TaskRow[],
  nested: readonly DrawnTaskRow[],
  at: number,
): number {
  const next = nested.slice(at).find(({ depth }) => depth === 0);
  return next === undefined ? rows.length : rows.indexOf(next.row);
}

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

export function useNestedRows(
  rows: readonly TaskRow[],
  opened: (taskId: string) => boolean,
  standing: (row: TaskRow) => boolean,
): readonly DrawnTaskRow[] {
  const drawn = drawnTaskRows(rows, opened, standing);
  const held = useRef(drawn);
  if (!sameDrawn(held.current, drawn)) held.current = drawn;
  return held.current;
}
