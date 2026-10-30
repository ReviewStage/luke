/**
 * fitted-columns.ts -- the columns a list of task rows draws at its own width: the Tasks page's List and a task's related tasks alike, folding the same columns away in the same order before a name is squeezed.
 *
 * A list measures the room it stands in as it resizes and hands its columns
 * to `listPropertiesFitting`, which folds each in `LIST_FOLD_ORDER` away in
 * turn until the rest leave its names their room; on a phone every column
 * that folds is folded. A list whose rows draw cells of their own beside
 * the List's columns, a related task's relation at its end, names the room
 * those take (`reserved`), which is counted out of its width first. Only
 * what is folded is state, never the width, so a window being dragged draws
 * the rows again only where a column comes or goes. Note that the first
 * measure lands before the list paints, so no row is ever drawn with its
 * name squeezed first, and that a list not laid out yet, which measures
 * nothing, folds nothing.
 */

import { LIST_FOLD_ORDER, type ListColumn, listPropertiesFitting } from "@luke/ui/tasks-page-model";
import { useLayoutEffect, useRef, useState } from "react";

/** Whether two runs of columns are the same, in the same order. */
function sameColumns(one: readonly ListColumn[], other: readonly ListColumn[]): boolean {
  return one.length === other.length && one.every((column, at) => column === other[at]);
}

/** The columns of `columns` that a list standing in `list` draws, those folded for its width left out. */
export function useFittedColumns<Column extends ListColumn>(
  list: HTMLElement | null,
  columns: readonly Column[],
  { narrow = false, reserved = 0 }: { narrow?: boolean; reserved?: number } = {},
): readonly Column[] {
  // Note that the columns are held while they stand as they did, so a caller handing them anew each render measures again only when they change.
  const held = useRef(columns);
  if (!sameColumns(held.current, columns)) held.current = columns;
  const steady = held.current;
  const [folded, setFolded] = useState<readonly ListColumn[]>([]);
  useLayoutEffect(() => {
    if (list === null || narrow) return undefined;
    const measure = () => {
      const { width } = list.getBoundingClientRect();
      if (width <= 0) return;
      const fitting = listPropertiesFitting(steady, width - reserved);
      const next = steady.filter((column) => !fitting.includes(column));
      setFolded((was) => (sameColumns(was, next) ? was : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [list, steady, narrow, reserved]);
  const left: readonly ListColumn[] = narrow ? LIST_FOLD_ORDER : folded;
  return steady.filter((column) => !left.includes(column));
}
