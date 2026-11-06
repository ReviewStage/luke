import { LIST_FOLD_ORDER, type ListColumn, listPropertiesFitting } from "@repo/ui/tasks-page-model";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

function sameColumns(one: readonly ListColumn[], other: readonly ListColumn[]): boolean {
  return one.length === other.length && one.every((column, at) => column === other[at]);
}

export function useFittedColumns<Column extends ListColumn>(
  list: HTMLElement | null,
  columns: readonly Column[],
  { narrow = false, reserved = 0 }: { narrow?: boolean; reserved?: number } = {},
): readonly Column[] {
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
  return useMemo(() => steady.filter((column) => !left.includes(column)), [steady, left]);
}
