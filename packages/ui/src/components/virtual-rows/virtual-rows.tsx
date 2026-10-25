import {
  measureElement,
  observeElementRect,
  type Rect,
  useVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cssCustomProperties } from "../../css.js";

/**
 * virtual-rows.tsx -- a long run of rows in a scroller of the caller's, drawing only those near the view, anchored to its last.
 *
 * A row is drawn while it stands within the view or `overscan` rows of it,
 * and the rest are the room they would take: a spacer before the first
 * drawn and after the last, the block's own padding, so the rows drawn stand in the flow as they
 * would with every row drawn, and the scroller's own scroll bar spans the
 * whole run. Each row is measured as it is drawn and as it resizes, its
 * height kept by its key, so a row scrolled out and back is placed by what
 * it measured rather than by `estimate`. Note that a row is never measured
 * while it is not laid out, in a tab kept in the tree but not shown, because
 * a height read there is none, and keeping it would draw every row at once
 * the next time the tab is shown; nor is the view, whose rows stay drawn
 * there rather than leave and be drawn again as it comes back.
 *
 * The run is anchored to its end (`anchorTo: "end"`): rows put before the
 * first leave the row the reader is on where it stood, and rows growing or
 * shrinking above the view move the scroll by as much, so a reader keeps
 * their place as older rows land and are measured. A row measured again, a
 * fold opened in it, moves the scroll only where the whole row stands above
 * the view, so nothing the reader sees moves. Following the newest row is
 * the caller's, whose scroller this is: while the caller says it holds the
 * end (`pinned`), the run puts the scroller back there after its own
 * writes. The run opens on its last rows.
 *
 * The run is a list to a reader, and each row drawn an item of it that says
 * how many rows the run holds and where it stands among them, since the
 * rows left undrawn are not there to be counted.
 *
 * The virtualizer is TanStack Virtual's: headless, so the rows are the
 * caller's own elements in the caller's own scroller, and the scroll logic
 * the caller already keeps is left as it was.
 */

/** The attribute the run's block wears, naming how many rows it holds and the key of its last, which changes exactly when a row lands at its end or its start. */
export const VIRTUAL_ROWS_ATTRIBUTE = "data-virtual-rows";

/** The attribute each drawn row wears naming its key. */
export const VIRTUAL_ROW_KEY_ATTRIBUTE = "data-row-key";

/** What a caller asks of the run once drawn. */
export interface VirtualRowsHandle {
  /**
   * Scrolls the row with `key` into the middle of the view, drawing it, and
   * hands its element to `then` once it is drawn there; false where no row
   * has that key.
   */
  readonly bringIn: (key: string, then?: (row: HTMLElement) => void) => boolean;
  /** The element of the row with `key` while it is drawn. */
  readonly rowElement: (key: string) => HTMLElement | undefined;
  /** The keys of the rows drawn now, in order. */
  readonly drawnKeys: () => readonly string[];
}

/** A row brought in and waiting to be drawn, and what is handed it then. */
interface Bringing {
  readonly key: string;
  readonly drawn: ((row: HTMLElement) => void) | undefined;
}

/** How many rows past each edge of the view are drawn, so a short scroll shows rows already laid out. */
const DEFAULT_OVERSCAN = 4;

/** The height a row's own measure keeps: what it measures where it is laid out, else what it measured last. */
function heightKept(
  element: HTMLElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLElement, HTMLElement>,
): number {
  if (element.getClientRects().length > 0) return measureElement(element, entry, instance);
  const index = instance.indexFromElement(element);
  return (
    instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
    instance.options.estimateSize(index)
  );
}

/**
 * Hears the scroller's size as it changes, but never a size of nothing,
 * which a scroller in a tab kept but not shown measures: the rows drawn
 * there stay drawn, so showing the tab again draws nothing anew.
 */
function sizeWhileShown(
  instance: Virtualizer<HTMLElement, HTMLElement>,
  hear: (rect: Rect) => void,
): (() => void) | undefined {
  return observeElementRect(instance, (rect) => {
    if (rect.height > 0) hear(rect);
  });
}

/** The room a run takes its view to have before its scroller is measured: the window's, which no view of it outgrows. */
function windowRect(): Rect {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * How far down the scroller's content `block` starts, which the virtualizer
 * counts its rows from: read from where each is laid out, which no scroll
 * moves, the scroller's own place taken off where the two are placed from
 * the same box.
 */
function offsetWithin(block: HTMLElement, scroller: HTMLElement): number {
  return block.offsetParent === scroller
    ? block.offsetTop
    : block.offsetTop - scroller.offsetTop - scroller.clientTop;
}

/** The classes the row at `index` wears: the run's own, then the caller's for it. */
function rowClassOf(
  rowClassName: string | ((index: number) => string) | undefined,
  index: number,
): string {
  const own = typeof rowClassName === "function" ? rowClassName(index) : rowClassName;
  return own === undefined ? "luke-virtual-row" : `luke-virtual-row ${own}`;
}

export function VirtualRows({
  scroller,
  pinned,
  keys,
  estimate,
  gap = 0,
  overscan = DEFAULT_OVERSCAN,
  className,
  rowClassName,
  handle,
  children,
}: {
  /** The element that scrolls, which the rows stand in. */
  scroller: RefObject<HTMLElement | null>;
  /** Whether the caller holds the scroller at its end right now, where the run then leaves it. */
  pinned?: (() => boolean) | undefined;
  /** Each row's key, in order: what its height is kept by. */
  keys: readonly string[];
  /** The height a row is taken to have before it is measured, in pixels. */
  estimate: number;
  /** The room between two rows, in pixels, which the stylesheet sets as the run's `--luke-virtual-gap`. */
  gap?: number;
  overscan?: number;
  className?: string | undefined;
  /** The class each row wears beside its own, or the class the row at an index wears. */
  rowClassName?: string | ((index: number) => string) | undefined;
  handle?: RefObject<VirtualRowsHandle | null> | undefined;
  /** Draws the row at an index. */
  children: (index: number) => ReactNode;
}): ReactNode {
  const block = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const latestKeys = useRef(keys);
  latestKeys.current = keys;
  const getItemKey = useCallback((index: number) => latestKeys.current[index] ?? index, []);
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count: keys.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimate,
    getItemKey,
    gap,
    overscan,
    scrollMargin: margin,
    anchorTo: "end",
    // Note that a run opens on its last rows, where its scroller opens.
    initialOffset: () => Math.max(0, margin + keys.length * (estimate + gap) - windowRect().height),
    measureElement: heightKept,
    observeElementRect: sizeWhileShown,
    initialRect: windowRect(),
    // Note that keeping to the last row is the caller's, never the run's: a row growing at the end moves nothing the caller did not ask to follow.
    scrollEndThreshold: -1,
    useFlushSync: false,
  });
  // How often the scroller has been sized anew, which can move what stands above the rows.
  const [sized, setSized] = useState(0);
  useEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const heard = new ResizeObserver(() => setSized((count) => count + 1));
    heard.observe(box);
    return () => heard.disconnect();
  }, [scroller]);
  // The rows' block stands below whatever the scroller draws above it, its padding among it.
  // Note that it is read only as the rows or the scroller's size change, never on a scroll's
  // draw, because reading where the block stands lays the whole log out again mid-frame.
  useLayoutEffect(() => {
    const element = block.current;
    const box = scroller.current;
    if (element === null || box === null) return;
    const at = Math.round(offsetWithin(element, box));
    setMargin((was) => (was === at ? was : at));
  }, [keys, sized, scroller]);
  // Note that a run held at its end goes back there after the virtualizer's own writes, because
  // as it first takes the scroller it scrolls to its guess (`initialOffset`), which a log
  // already at its end hears as the reader scrolling up.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box === null || pinned?.() !== true) return;
    const end = box.scrollHeight - box.clientHeight;
    if (box.scrollTop < end) box.scrollTop = end;
  });
  const bringing = useRef<Bringing | undefined>(undefined);
  const rowElement = useCallback(
    (key: string) =>
      block.current?.querySelector<HTMLElement>(
        `:scope > [${VIRTUAL_ROW_KEY_ATTRIBUTE}="${CSS.escape(key)}"]`,
      ) ?? undefined,
    [],
  );
  useImperativeHandle(
    handle,
    () => ({
      bringIn: (key, then) => {
        const index = latestKeys.current.indexOf(key);
        if (index === -1) return false;
        bringing.current = { key, drawn: then };
        virtualizer.scrollToIndex(index, { align: "center" });
        return true;
      },
      rowElement,
      drawnKeys: () =>
        [...(block.current?.children ?? [])].flatMap((row) => {
          const key = row.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE);
          return key === null ? [] : [key];
        }),
    }),
    [virtualizer, rowElement],
  );
  // A row brought in is handed on once it is drawn.
  useLayoutEffect(() => {
    const asked = bringing.current;
    if (asked === undefined) return;
    const row = rowElement(asked.key);
    if (row === undefined) return;
    bringing.current = undefined;
    asked.drawn?.(row);
  });
  const items: VirtualItem[] = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items.at(-1);
  const before = first === undefined ? 0 : first.start - margin;
  const after = last === undefined ? 0 : virtualizer.getTotalSize() - (last.end - margin);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the block is a flow of the caller's own rows, which a <ul>'s list styling and a <li>'s marker would reach.
    <div
      ref={block}
      role="list"
      className={className === undefined ? "luke-virtual-rows" : `luke-virtual-rows ${className}`}
      {...{ [VIRTUAL_ROWS_ATTRIBUTE]: `${keys.length}:${keys.at(-1) ?? ""}:${keys[0] ?? ""}` }}
      // Note that the spacers are the block's own padding rather than properties its rows inherit, because a property the rows inherit is read again for every element in them each time the drawn rows move.
      style={{
        ...cssCustomProperties({ "--luke-virtual-gap": `${gap}px` }),
        paddingBlockStart: `${Math.max(0, before)}px`,
        paddingBlockEnd: `${Math.max(0, after)}px`,
      }}
    >
      {items.map((item) => (
        // biome-ignore lint/a11y/useSemanticElements: see the block above.
        <div
          key={item.key}
          ref={virtualizer.measureElement}
          data-index={item.index}
          role="listitem"
          aria-setsize={keys.length}
          aria-posinset={item.index + 1}
          {...{ [VIRTUAL_ROW_KEY_ATTRIBUTE]: String(item.key) }}
          className={rowClassOf(rowClassName, item.index)}
        >
          {children(item.index)}
        </div>
      ))}
    </div>
  );
}
