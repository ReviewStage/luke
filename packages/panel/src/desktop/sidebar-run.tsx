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

const ROW_ESTIMATE_PX = 28;

const ROW_GAP_PX = 2;

export interface SidebarRunsPlace {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly body: RefObject<HTMLElement | null>;
  readonly finding: boolean;
  readonly holdRun: VirtualRuns["hold"];
}

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
  drops?: boolean;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
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
