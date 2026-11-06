import { RESIZE_EDGE_SIDE, type ResizeEdgeHandle, useResizeEdge } from "@repo/ui";
import { type RefObject, useCallback, useState } from "react";
import { SIDEBAR_WIDTH, type SidebarCollapse } from "./desktop/sidebar-collapse.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";

const COLUMN_SPLIT = {
  ENTER: 860,
  LEAVE: 892,
} as const;

const LIST_SHARE = 0.35;

function oneColumn(width: number, was: boolean): boolean {
  return width < (was ? COLUMN_SPLIT.LEAVE : COLUMN_SPLIT.ENTER);
}

interface ColumnSplit {
  readonly ref: (element: HTMLElement | null) => (() => void) | undefined;
  readonly single: boolean | undefined;
}

export function useColumnSplit(): ColumnSplit {
  const [single, setSingle] = useState<boolean | undefined>(undefined);
  const ref = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setSingle((was) => oneColumn(width, was === true));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, single };
}

interface ScreenSplit {
  readonly ref: (element: HTMLElement | null) => (() => void) | undefined;
  readonly single: boolean;
  readonly columns: ShellRoom;
}

export function useScreenSplit(room: ShellRoom): ScreenSplit {
  const { ref, single: measured } = useColumnSplit();
  const single = room === SHELL_ROOM.NARROW || measured === true;
  return { ref, single, columns: single ? SHELL_ROOM.NARROW : SHELL_ROOM.WIDE };
}

export function useScreenRef<Element extends HTMLElement>(
  held: RefObject<Element | null>,
  measure: ScreenSplit["ref"],
): (element: Element | null) => () => void {
  return useCallback(
    (element: Element | null) => {
      held.current = element;
      const unmeasure = measure(element);
      return () => {
        held.current = null;
        unmeasure?.();
      };
    },
    [held, measure],
  );
}

export function useListEdge(sidebar: SidebarCollapse): ResizeEdgeHandle {
  return useResizeEdge({
    side: RESIZE_EDGE_SIDE.RIGHT,
    width: sidebar.width,
    bounds: SIDEBAR_WIDTH,
    reserve: (screen) => screen.getBoundingClientRect().width * (1 - LIST_SHARE),
    label: "Resize sidebar",
    onResize: sidebar.onResize,
  });
}
