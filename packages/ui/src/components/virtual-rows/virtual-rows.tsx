import {
  defaultRangeExtractor,
  measureElement,
  observeElementRect,
  type Range,
  type Rect,
  useVirtualizer,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual";
import {
  type FocusEvent,
  Fragment,
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
import { askScroll } from "../../scroll-asked.js";
import { motionRows } from "../list-motion/list-motion.js";

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
 * A run read from its top, as a list of items is, is anchored to its start
 * instead (`VIRTUAL_ROWS_ANCHOR.START`): it opens wherever its scroller
 * stands, and rows growing or shrinking above the view move the scroll by
 * as much, as the end-anchored run's do. Several runs may stand in one
 * scroller, a list's groups each a run, each counting its rows from where
 * it stands in the scroller; a box whose resizing moves where a run stands,
 * the list around the runs, is heard as the scroller's own size is
 * (`shiftedBy`), so each run reads its place again as the runs above it
 * grow, shrink, or fold.
 *
 * The run is a list to a reader, and each row drawn an item of it that says
 * how many rows the run holds and where it stands among them, since the
 * rows left undrawn are not there to be counted. Where the rows are list
 * items of the caller's own (`listItems`), as a `ListRow` is, the run is a
 * `<ul>` that wraps none of them, and each row wears its place
 * (`VirtualRowPlace`) on its own `<li>`. A run whose rows move as a list's do
 * wears what `ListMotion` reads (`moves`), each row being a mover.
 *
 * Where it is asked to (`holdsFocus`), as a list walked by the keyboard
 * is, a row holding the keyboard stays drawn wherever the run is scrolled,
 * with every row between it and the view, so the keyboard is never dropped
 * by a scroll and ↑↓ go on from the row it is in. Note that the rows
 * between are drawn rather than left out, because the run lays its rows out
 * in the flow, which a gap among them would break; and that a log, whose
 * rows run to thousands, holds nothing, so a scroll away from a press in
 * one of its messages draws no more than the view.
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

/** Which end of a run keeps the reader's place: its last row, as a log's, or its first, as a list read from its top. */
export const VIRTUAL_ROWS_ANCHOR = {
  START: "start",
  END: "end",
} as const;

export type VirtualRowsAnchor = (typeof VIRTUAL_ROWS_ANCHOR)[keyof typeof VIRTUAL_ROWS_ANCHOR];

/** What a row the caller draws as its own list item wears (`listItems`): what measures it, and what tells a reader and the run where it stands. */
export interface VirtualRowPlace {
  readonly ref: (element: HTMLElement | null) => void;
  readonly "data-index": number;
  readonly "data-row-key": string;
  readonly "aria-setsize": number;
  readonly "aria-posinset": number;
}

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

/** How far down `element` stands from the box `ancestor` places it from, through every box placing it on the way; from the page where none does. */
function offsetTo(element: HTMLElement, ancestor: Element | null): number {
  let top = 0;
  let at: HTMLElement = element;
  for (;;) {
    top += at.offsetTop;
    const parent = at.offsetParent;
    if (!(parent instanceof HTMLElement) || parent === ancestor) return top;
    top += parent.clientTop;
    at = parent;
  }
}

/**
 * How far down the scroller's content `block` starts, which the virtualizer
 * counts its rows from: read from where each is laid out, which no scroll
 * or transform moves, through the boxes placing the block up to the first
 * that is the scroller or holds it, the scroller's own place in that box
 * taken off where it is not the scroller. Note that a box placing the block
 * may stand inside the scroller, as a list's own body does around a run of
 * its rows, so the block's own offset alone is not its place.
 */
function offsetWithin(block: HTMLElement, scroller: HTMLElement): number {
  let holder = block.offsetParent;
  while (holder instanceof HTMLElement && holder !== scroller && !holder.contains(scroller)) {
    holder = holder.offsetParent;
  }
  return holder === scroller
    ? offsetTo(block, scroller)
    : offsetTo(block, holder) - offsetTo(scroller, holder) - scroller.clientTop;
}

/** The classes the row at `index` wears: the run's own, then the caller's for it. */
function rowClassOf(
  rowClassName: string | ((index: number) => string) | undefined,
  index: number,
): string {
  const own = typeof rowClassName === "function" ? rowClassName(index) : rowClassName;
  return own === undefined ? "luke-virtual-row" : `luke-virtual-row ${own}`;
}

/** The row of the run that `target` stands in: the child of `block` holding it, none where it is outside every row. */
function rowHolding(block: HTMLElement | null, target: EventTarget): Element | undefined {
  if (block === null || !(target instanceof Element)) return undefined;
  let at: Element | null = target;
  while (at !== null && at.parentElement !== block) at = at.parentElement;
  return at ?? undefined;
}

export function VirtualRows({
  scroller,
  pinned,
  keys,
  estimate,
  gap = 0,
  overscan = DEFAULT_OVERSCAN,
  anchor = VIRTUAL_ROWS_ANCHOR.END,
  listItems = false,
  moves = false,
  holdsFocus = false,
  shiftedBy,
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
  overscan?: number | undefined;
  /** Which end keeps the reader's place: the last row, as a log's, unless said. */
  anchor?: VirtualRowsAnchor;
  /** Whether each row is a list item of the caller's own, wearing the place it is handed, in a run that is a `<ul>` wrapping none. */
  listItems?: boolean;
  /** Whether the rows move as a list's do (`ListMotion`), each a mover. */
  moves?: boolean;
  /** Whether a row holding the keyboard stays drawn wherever the run is scrolled, as a list the keyboard walks keeps it. */
  holdsFocus?: boolean;
  /** A box whose resizing moves where the run stands in its scroller, as the list holding it among other runs. */
  shiftedBy?: RefObject<HTMLElement | null> | undefined;
  className?: string | undefined;
  /** The class each row wears beside its own, or the class the row at an index wears; the caller's own where its rows are list items. */
  rowClassName?: string | ((index: number) => string) | undefined;
  handle?: RefObject<VirtualRowsHandle | null> | undefined;
  /** Draws the row at an index, which wears `place` where its rows are list items of the caller's own. */
  children: (index: number, place: VirtualRowPlace) => ReactNode;
}): ReactNode {
  const block = useRef<HTMLElement | null>(null);
  const holdBlock = useCallback((element: HTMLElement | null) => {
    block.current = element;
  }, []);
  const [margin, setMargin] = useState(0);
  const latestKeys = useRef(keys);
  latestKeys.current = keys;
  const getItemKey = useCallback((index: number) => latestKeys.current[index] ?? index, []);
  const fromEnd = anchor === VIRTUAL_ROWS_ANCHOR.END;
  // The row holding the keyboard, by its key, which is drawn wherever the run is scrolled.
  const focused = useRef<string | undefined>(undefined);
  const rangeExtractor = useCallback((range: Range) => {
    const drawn = defaultRangeExtractor(range);
    const key = focused.current;
    const at = key === undefined ? -1 : latestKeys.current.indexOf(key);
    const first = drawn[0];
    const last = drawn.at(-1);
    if (at < 0 || first === undefined || last === undefined || (at >= first && at <= last)) {
      return drawn;
    }
    // Note that the rows between are drawn with it, since the run lays its rows out in the flow.
    const from = Math.min(at, first);
    return Array.from({ length: Math.max(at, last) - from + 1 }, (_, step) => from + step);
  }, []);
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count: keys.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => estimate,
    getItemKey,
    gap,
    overscan,
    rangeExtractor,
    scrollMargin: margin,
    anchorTo: fromEnd ? "end" : "start",
    // Note that a run anchored to its end opens on its last rows, where its scroller opens, and one anchored to its start wherever its scroller stands, which it never scrolls to take.
    initialOffset: () =>
      fromEnd
        ? Math.max(0, margin + keys.length * (estimate + gap) - windowRect().height)
        : (scroller.current?.scrollTop ?? 0),
    measureElement: heightKept,
    observeElementRect: sizeWhileShown,
    initialRect: windowRect(),
    // Note that keeping to the last row is the caller's, never the run's: a row growing at the end moves nothing the caller did not ask to follow.
    scrollEndThreshold: -1,
    useFlushSync: false,
  });
  // How often the scroller, or the box that moves the run, has been sized anew, which can move what stands above the rows.
  const [sized, setSized] = useState(0);
  useEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const heard = new ResizeObserver(() => setSized((count) => count + 1));
    heard.observe(box);
    const shifting = shiftedBy?.current;
    if (shifting !== undefined && shifting !== null) heard.observe(shifting);
    return () => heard.disconnect();
  }, [scroller, shiftedBy]);
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
        const box = scroller.current;
        if (box !== null) askScroll(box);
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
  // Each row's place, kept while it stands at the same index of a run as long, so a row drawn again as the run scrolls is handed the same one.
  const places = useRef(new Map<VirtualItem["key"], VirtualRowPlace>());
  const placeOf = (item: VirtualItem): VirtualRowPlace => {
    const held = places.current.get(item.key);
    if (
      held !== undefined &&
      held["data-index"] === item.index &&
      held["aria-setsize"] === keys.length
    ) {
      return held;
    }
    const place: VirtualRowPlace = {
      ref: virtualizer.measureElement,
      "data-index": item.index,
      [VIRTUAL_ROW_KEY_ATTRIBUTE]: String(item.key),
      "aria-setsize": keys.length,
      "aria-posinset": item.index + 1,
    };
    places.current.set(item.key, place);
    return place;
  };
  useLayoutEffect(() => {
    const listed = new Set<VirtualItem["key"]>(keys);
    for (const key of places.current.keys()) if (!listed.has(key)) places.current.delete(key);
  }, [keys]);
  const items: VirtualItem[] = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items.at(-1);
  const before = first === undefined ? 0 : first.start - margin;
  const after = last === undefined ? 0 : virtualizer.getTotalSize() - (last.end - margin);
  const own = listItems ? "luke-virtual-rows luke-virtual-items" : "luke-virtual-rows";
  const run = {
    ref: holdBlock,
    className: className === undefined ? own : `${own} ${className}`,
    ...{ [VIRTUAL_ROWS_ATTRIBUTE]: `${keys.length}:${keys.at(-1) ?? ""}:${keys[0] ?? ""}` },
    ...(moves ? motionRows() : {}),
    // Note that the spacers are the block's own padding rather than properties its rows inherit, because a property the rows inherit is read again for every element in them each time the drawn rows move.
    style: {
      ...cssCustomProperties({ "--luke-virtual-gap": `${gap}px` }),
      paddingBlockStart: `${Math.max(0, before)}px`,
      paddingBlockEnd: `${Math.max(0, after)}px`,
    },
    // Note that the row holding the keyboard is kept as it takes it and let go as it loses it, a row taking it from another being kept in its place.
    ...(holdsFocus
      ? {
          onFocus: (event: FocusEvent<HTMLElement>) => {
            focused.current =
              rowHolding(block.current, event.target)?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE) ??
              undefined;
          },
          onBlur: () => {
            focused.current = undefined;
          },
        }
      : {}),
  };
  if (listItems) {
    return (
      // biome-ignore lint/a11y/noRedundantRoles: Safari's VoiceOver stops reading a list drawn without its markers as a list unless it says so, as `Stack`'s lists say.
      <ul {...run} role="list">
        {items.map((item) => (
          <Fragment key={item.key}>{children(item.index, placeOf(item))}</Fragment>
        ))}
      </ul>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: the block is a flow of the caller's own rows, which a <ul>'s list styling and a <li>'s marker would reach.
    <div {...run} role="list">
      {items.map((item) => {
        const place = placeOf(item);
        return (
          // biome-ignore lint/a11y/useSemanticElements: see the block above.
          <div
            key={item.key}
            ref={place.ref}
            data-index={item.index}
            role="listitem"
            aria-setsize={place["aria-setsize"]}
            aria-posinset={place["aria-posinset"]}
            {...{ [VIRTUAL_ROW_KEY_ATTRIBUTE]: place[VIRTUAL_ROW_KEY_ATTRIBUTE] }}
            className={rowClassOf(rowClassName, item.index)}
          >
            {children(item.index, place)}
          </div>
        );
      })}
    </div>
  );
}
