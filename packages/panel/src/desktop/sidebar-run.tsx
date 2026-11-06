import {
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsBlock,
  type VirtualRowsHandle,
  type VirtualRuns,
} from "@repo/ui/virtual-rows";
import {
  type PointerEventHandler,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";

/**
 * sidebar-run.tsx -- one of the sidebar's lists of rows, drawing only those near the view.
 *
 * Every list of the sidebar's rows, Pinned's, a section's, and each of
 * Tasks' groups, is a run of one scroller, the column's (`VirtualRows`), as
 * the Inbox's groups are: each counts its rows from where it stands in the
 * column and reads its place again as the lists above it grow, shrink, or
 * fold (`shiftedBy`), and draws every row while a find bar stands open, so
 * the find covers them. Its rows move as a list's do (`ListMotion`), the
 * row holding the keyboard stays drawn wherever the column is scrolled,
 * and each run is held while it stands (`holdRun`), so the column's keys
 * bring in a row any run leaves undrawn.
 */

/** The height a sidebar row is taken to have before it is measured, in pixels: a dense `ListRow`'s, one line. */
const ROW_ESTIMATE_PX = 28;

/** The room between two sidebar rows, in pixels: a list's (`--ui-list-gap`). */
const ROW_GAP_PX = 2;

/** Where the sidebar's runs stand: the column's scroller, its body, whose resizing moves the runs below a list that grew or folded, whether a find bar stands open, and where each run is held while it stands. */
export interface SidebarRunsPlace {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly body: RefObject<HTMLElement | null>;
  readonly finding: boolean;
  readonly holdRun: VirtualRuns["hold"];
}

/** A list of the sidebar's rows, `keys` each row's in order, drawing the row at an index wearing its place. */
export function SidebarRun({
  place,
  keys,
  drops = false,
  onPointerDown,
  block,
  children,
}: {
  place: SidebarRunsPlace;
  keys: readonly string[];
  /** Whether it keeps an order a row carried in from another list lands at a place in (`use-row-drag.ts`). */
  drops?: boolean;
  /** Hears a press on its rows, which drags them (`use-row-drag.ts`). */
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  /** What its block wears beside its own, as the keys that move its rows (`useRowMoveKeys`). */
  block?: VirtualRowsBlock | undefined;
  children: (index: number, at: VirtualRowPlace) => ReactNode;
}): React.JSX.Element {
  const handle = useRef<VirtualRowsHandle>(null);
  const { holdRun } = place;
  useLayoutEffect(() => holdRun(handle), [holdRun]);
  return (
    <VirtualRows
      scroller={place.scroller}
      shiftedBy={place.body}
      keys={keys}
      estimate={ROW_ESTIMATE_PX}
      gap={ROW_GAP_PX}
      overscan={place.finding ? keys.length : undefined}
      anchor={VIRTUAL_ROWS_ANCHOR.START}
      listItems
      moves
      holdsFocus
      className="sidebar-tasks"
      data-row-drop-rows={drops ? "" : undefined}
      onPointerDown={onPointerDown}
      block={block}
      handle={handle}
    >
      {children}
    </VirtualRows>
  );
}
