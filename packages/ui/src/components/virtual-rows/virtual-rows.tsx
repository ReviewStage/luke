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
  type CSSProperties,
  type FocusEvent,
  Fragment,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { joinRefs } from "../../join-refs.js";
import { motionRows } from "../list-motion/list-motion.js";
import { type RovingReach, reachedKey, rovingItemIn } from "../roving-keys/roving-keys.js";

/**
 * virtual-rows.tsx -- a long run of rows in a scroller of the caller's, drawing only those near the view, anchored to its last.
 *
 * A row is drawn while it stands within the view or `overscan` rows of it,
 * placed as TanStack Virtual's docs place a row: absolutely, inside a block
 * as tall as every row would stand (`containerRef`), the virtualizer
 * writing each row's top and the block's height itself
 * (`directDomUpdates`), by `top` rather than a transform, so a row's own
 * transform stays the list's to move it by (`ListMotion`). The scroller's
 * own scroll bar spans the whole run. Each row is measured as it is drawn
 * and as it resizes, so a row scrolled out and back is placed by what it
 * measured rather than by `estimate`. Note that a row is never measured
 * while it is not laid out, in a tab kept in the tree but not shown,
 * because a height read there is none: the run keeps what each row last
 * measured by its key and answers that, as the docs ask of a
 * `measureElement` of one's own (`useCachedMeasurements`); nor is the view,
 * whose rows stay drawn there rather than leave and be drawn again as it
 * comes back.
 *
 * The run is anchored to its end (`anchorTo: "end"`), as the docs' chat
 * guide anchors a log: rows put before the first leave the row the reader
 * is on where it stood, a row growing at the end keeps a reader at the end
 * there, and a row appended follows on to it where the reader stood within
 * `scrollEndThreshold` of the end (`followOnAppend`). The run opens on its
 * last rows (`scrollToEnd()` once mounted), and its caller asks whether it
 * stands at its end and takes it there through its handle.
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
 * (`VirtualRowPlace`) on its own `<li>`. Where the rows are the options of
 * the caller's own listbox (`options`), which owns options and their groups
 * alone, the run is a block of no role of its own, wrapping none of them,
 * and each option wears its place, so a reader hears the options as the
 * listbox's and each one's place among them. A run whose rows move as a list's do
 * wears what `ListMotion` reads (`moves`), each row being a mover. A run is
 * named to a reader as a list is (`aria-label`), and a run whose rows are
 * dragged hears the press on its block and says it keeps an order a row is
 * dropped at a place in, as any list of dragged rows does (`onPointerDown`,
 * `data-row-drop-rows`), the drag counting a place from the first row drawn
 * (`data-index`).
 *
 * A run that is a list of the caller's own, whose block wears what the list
 * itself wears, as `List`'s run of `ListRow`s does, is handed that
 * (`block`): its id, its data attributes, the keys it hears, and what holds
 * it, beside the run's own, so the list's sheet reaches its rows as its
 * children and its keys walk them.
 *
 * A list of several runs, a list's groups each one, holds each while it
 * stands (`useVirtualRuns`), so a row any of them leaves undrawn is brought
 * in by its key alone.
 *
 * Where it is asked to (`holdsFocus`), as a list walked by the keyboard
 * is, a row holding the keyboard stays drawn wherever the run is scrolled,
 * as the docs' sticky example keeps its sticky rows (`rangeExtractor`), so
 * the keyboard is never dropped by a scroll and ↑↓ go on from the row it is
 * in. Note that a log, whose rows run to thousands, holds nothing, so a
 * scroll away from a press in one of its messages draws no more than the
 * view.
 *
 * The virtualizer is TanStack Virtual's, used as its docs show: headless,
 * so the rows are the caller's own elements in the caller's own scroller.
 */

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
  /** Every row's key, in order, those left undrawn among them. */
  readonly keys: () => readonly string[];
  /** Scrolls to the end of the scroller (`scrollToEnd()`). */
  readonly scrollToEnd: () => void;
}

/** A list's runs, each held while it stands, and the bringing in of a row whichever run lists it. */
export interface VirtualRuns {
  /** Holds a run while it stands; the answer lets it go. */
  readonly hold: (run: RefObject<VirtualRowsHandle | null>) => () => void;
  /** Brings in the row with `key` as its run's `bringIn` does, whichever run lists it; false where none does. */
  readonly bringIn: (key: string, then?: (row: HTMLElement) => void) => boolean;
  /** Every row's key of every run, those left undrawn among them, the runs in the order they stand in the document. */
  readonly keys: () => readonly string[];
}

/** A row brought in and waiting to be drawn, and what is handed it then. */
interface Bringing {
  readonly key: string;
  readonly drawn: ((row: HTMLElement) => void) | undefined;
}

/** How many rows past each edge of the view are drawn, so a short scroll shows rows already laid out. */
const DEFAULT_OVERSCAN = 4;

/** How near its end, in pixels, a run anchored to its end counts as standing there, so a row appended follows on to it: the docs' chat guide's. */
const END_THRESHOLD_PX = 80;

/** What a run's block wears for a list of the caller's own (`block`): what holds it, its id, the keys and focus it hears, and its data attributes. */
export interface VirtualRowsBlock {
  readonly ref?: Ref<HTMLElement> | undefined;
  readonly id?: string | undefined;
  readonly onKeyDown?: KeyboardEventHandler<HTMLElement> | undefined;
  readonly onFocus?: ((event: FocusEvent<HTMLElement>) => void) | undefined;
  readonly [data: `data-${string}`]: string | undefined;
}

/** Where a row stands in its block, as the docs place one: absolutely, across the block, its top the virtualizer's to write. */
const ROW_STYLE: CSSProperties = { position: "absolute", insetInline: 0 };

/** Which end of a run keeps the reader's place: its last row, as a log's, or its first, as a list read from its top. */
export const VIRTUAL_ROWS_ANCHOR = {
  START: "start",
  END: "end",
} as const;

export type VirtualRowsAnchor = (typeof VIRTUAL_ROWS_ANCHOR)[keyof typeof VIRTUAL_ROWS_ANCHOR];

/** What a row the caller draws as its own list item wears (`listItems`): what measures it, and what tells a reader and the run where it stands. */
export interface VirtualRowPlace {
  readonly ref: (element: HTMLElement | null) => void;
  readonly style: CSSProperties;
  readonly "data-index": number;
  readonly "data-row-key": string;
  readonly "aria-setsize": number;
  readonly "aria-posinset": number;
}

/**
 * Hears the scroller's size as it changes, but never a size of nothing,
 * which a scroller in a tab kept but not shown measures: the rows drawn
 * there stay drawn, so showing the tab again draws nothing anew.
 */
export function sizeWhileShown<Item extends Element>(
  instance: Virtualizer<HTMLElement, Item>,
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

/** Whether two runs of keys name the same rows in the same order. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, at) => key === b[at]);
}

/** The keys as last handed, kept while they name the same rows in the same order, so a caller handing them anew on each draw has the virtualizer read nothing again. */
function useSteadyKeys(keys: readonly string[]): readonly string[] {
  const held = useRef(keys);
  if (held.current !== keys && !sameKeys(held.current, keys)) held.current = keys;
  return held.current;
}

/** The classes the row at `index` wears: the run's own, then the caller's for it. */
function rowClassOf(
  rowClassName: string | ((index: number) => string) | undefined,
  index: number,
): string {
  const own = typeof rowClassName === "function" ? rowClassName(index) : rowClassName;
  return own === undefined ? "ui-virtual-row" : `ui-virtual-row ${own}`;
}

/** The row of the run that `target` stands in: the child of `block` holding it, none where it is outside every row. */
function rowHolding(block: HTMLElement | null, target: EventTarget): Element | undefined {
  if (block === null || !(target instanceof Element)) return undefined;
  let at: Element | null = target;
  while (at !== null && at.parentElement !== block) at = at.parentElement;
  return at ?? undefined;
}

/**
 * What a list of one run hands its walk (`useRovingKeys`' `reach`): a key
 * goes on to the row of the run it reaches, wherever it stands, its item
 * (`rovingItemIn`) taking the focus, the row brought in where it is not
 * drawn.
 */
export function reachInRun(
  run: RefObject<VirtualRowsHandle | null>,
): (from: HTMLElement | undefined, to: RovingReach) => boolean {
  return (from, to) => {
    const handle = run.current;
    if (handle === null) return false;
    const inHand = from
      ?.closest(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}]`)
      ?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE);
    const key = reachedKey(handle.keys(), inHand ?? undefined, to);
    if (key === undefined) return false;
    const drawn = handle.rowElement(key);
    const item = drawn === undefined ? undefined : rovingItemIn(drawn);
    if (item !== undefined) {
      item.focus();
      return true;
    }
    return handle.bringIn(key, (row) => rovingItemIn(row)?.focus());
  };
}

/** A list's runs (`VirtualRuns`), held from its first draw to its last. */
export function useVirtualRuns(): VirtualRuns {
  const [runs] = useState((): VirtualRuns => {
    const held = new Set<RefObject<VirtualRowsHandle | null>>();
    return {
      hold: (run) => {
        held.add(run);
        return () => {
          held.delete(run);
        };
      },
      bringIn: (key, then) => [...held].some((run) => run.current?.bringIn(key, then) === true),
      keys: () => {
        // Note that a run is placed by its first row drawn, since every run holding a row draws one.
        const placed = [...held].flatMap((run) => {
          const handle = run.current;
          const first = handle?.drawnKeys()[0];
          const row = first === undefined ? undefined : handle?.rowElement(first);
          return handle === null || handle === undefined || row === undefined
            ? []
            : [{ handle, row }];
        });
        placed.sort((a, b) =>
          a.row.compareDocumentPosition(b.row) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        );
        return placed.flatMap(({ handle }) => handle.keys());
      },
    };
  });
  return runs;
}

export function VirtualRows({
  scroller,
  keys,
  estimate,
  gap = 0,
  overscan = DEFAULT_OVERSCAN,
  anchor = VIRTUAL_ROWS_ANCHOR.END,
  listItems = false,
  options = false,
  moves = false,
  holdsFocus = false,
  shiftedBy,
  onAtEnd,
  className,
  rowClassName,
  handle,
  "aria-label": label,
  onPointerDown,
  "data-row-drop-rows": dropRows,
  block: wears,
  children,
}: {
  /** The element that scrolls, which the rows stand in. */
  scroller: RefObject<HTMLElement | null>;
  /** Each row's key, in order: what its height is kept by. */
  keys: readonly string[];
  /** The height a row is taken to have before it is measured, in pixels. */
  estimate: number;
  /** The room between two rows, in pixels. */
  gap?: number;
  overscan?: number | undefined;
  /** Which end keeps the reader's place: the last row, as a log's, unless said. */
  anchor?: VirtualRowsAnchor;
  /** Whether each row is a list item of the caller's own, wearing the place it is handed, in a run that is a `<ul>` wrapping none. */
  listItems?: boolean;
  /** Whether each row is an option of the caller's own listbox, wearing the place it is handed, in a run of no role of its own that wraps none. */
  options?: boolean;
  /** Whether the rows move as a list's do (`ListMotion`), each a mover. */
  moves?: boolean;
  /** Whether a row holding the keyboard stays drawn wherever the run is scrolled, as a list the keyboard walks keeps it. */
  holdsFocus?: boolean;
  /** A box whose resizing moves where the run stands in its scroller, as the list holding it among other runs. */
  shiftedBy?: RefObject<HTMLElement | null> | undefined;
  /** Hears whether the scroller stands at its end (`isAtEnd()`) each time the virtualizer's state changes, a scroll's start and end among it. */
  onAtEnd?: ((atEnd: boolean) => void) | undefined;
  className?: string | undefined;
  /** The class each row wears beside its own, or the class the row at an index wears; the caller's own where its rows are list items. */
  rowClassName?: string | ((index: number) => string) | undefined;
  handle?: RefObject<VirtualRowsHandle | null> | undefined;
  /** What the run is called, to a reader, as a group's rows are named by its head. */
  "aria-label"?: string | undefined;
  /** Hears a press on the run's block, where its rows are dragged (`use-row-drag.ts`). */
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  /** Says the run keeps an order of its own that a row dragged into it is dropped at a place in (`use-row-drag.ts`). */
  "data-row-drop-rows"?: "" | undefined;
  /** What the block wears beside the run's own, where the run is a list of the caller's own, as `List`'s is. */
  block?: VirtualRowsBlock | undefined;
  /** Draws the row at an index, which wears `place` where its rows are list items or options of the caller's own. */
  children: (index: number, place: VirtualRowPlace) => ReactNode;
}): ReactNode {
  const block = useRef<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  const latestKeys = useRef(keys);
  latestKeys.current = keys;
  // Note that the key reader changes as the keys do, because the virtualizer reads every row's key again only when it does: a row moved to another place, the run as long as before, would otherwise stand under the key of the row that stood there, and two rows under one key leave a row drawn that no row is any longer.
  const steady = useSteadyKeys(keys);
  const getItemKey = useCallback((index: number) => steady[index] ?? index, [steady]);
  const fromEnd = anchor === VIRTUAL_ROWS_ANCHOR.END;
  // The row holding the keyboard, by its key, which is drawn wherever the run is scrolled.
  const focused = useRef<string | undefined>(undefined);
  const rangeExtractor = useCallback((range: Range) => {
    const drawn = defaultRangeExtractor(range);
    const key = focused.current;
    const at = key === undefined ? -1 : latestKeys.current.indexOf(key);
    if (at < 0 || drawn.includes(at)) return drawn;
    return [...drawn, at].sort((a, b) => a - b);
  }, []);
  // What each row last measured where it was laid out, by its key, answered while it is not (`useCachedMeasurements`).
  const heights = useRef(new Map<string, number>());
  const measured = useCallback(
    (
      element: HTMLElement,
      entry: ResizeObserverEntry | undefined,
      instance: Virtualizer<HTMLElement, HTMLElement>,
    ): number => {
      const key = element.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE) ?? "";
      if (element.getClientRects().length === 0) return heights.current.get(key) ?? estimate;
      const height = measureElement(element, entry, instance);
      heights.current.set(key, height);
      return height;
    },
    [estimate],
  );
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
    followOnAppend: fromEnd,
    scrollEndThreshold: END_THRESHOLD_PX,
    // Note that the run opens wherever its scroller stands, kept as the reader left it, since several runs may share it; one anchored to its end then takes it there.
    initialOffset: () => scroller.current?.scrollTop ?? 0,
    measureElement: measured,
    observeElementRect: sizeWhileShown,
    initialRect: windowRect(),
    onChange: (instance) => onAtEnd?.(instance.isAtEnd()),
    useFlushSync: false,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
  });
  // A run anchored to its end opens there once the virtualizer holds its scroller, and only once, so a page kept hidden and shown again leaves it where the reader left it.
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (!fromEnd || opened.current || virtualizer.scrollElement === null) return;
    opened.current = true;
    virtualizer.scrollToEnd();
  });
  const holdBlock = useCallback(
    (element: HTMLElement | null) => {
      block.current = element;
      virtualizer.containerRef(element);
    },
    [virtualizer],
  );
  const blockRef = wears?.ref;
  const heldBlock = useMemo(
    () => (blockRef === undefined ? holdBlock : joinRefs(holdBlock, blockRef)),
    [holdBlock, blockRef],
  );
  // How often the scroller, or the box that moves the run, has been sized anew, which can move what stands above the rows.
  const [sized, setSized] = useState(0);
  // Note that the run draws again as it first finds its scroller, because the scroller is the caller's, whose ref is set only after the run's own layout effects, and the virtualizer takes it as it draws.
  useEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    setSized((count) => count + 1);
    const heard = new ResizeObserver(() => setSized((count) => count + 1));
    heard.observe(box);
    const shifting = shiftedBy?.current;
    if (shifting !== undefined && shifting !== null) heard.observe(shifting);
    return () => heard.disconnect();
  }, [scroller, shiftedBy]);
  // The rows' block stands below whatever the scroller draws above it, its padding among it (`scrollMargin`).
  // Note that it is read only as the rows or the scroller's size change, never on a scroll's
  // draw, because reading where the block stands lays the whole log out again mid-frame.
  useLayoutEffect(() => {
    const element = block.current;
    const box = scroller.current;
    if (element === null || box === null) return;
    const at = Math.round(offsetWithin(element, box));
    setMargin((was) => (was === at ? was : at));
  }, [keys, sized, scroller]);
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
      keys: () => latestKeys.current,
      scrollToEnd: () => virtualizer.scrollToEnd(),
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
      style: ROW_STYLE,
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
    for (const key of heights.current.keys()) if (!listed.has(key)) heights.current.delete(key);
  }, [keys]);
  const items: VirtualItem[] = virtualizer.getVirtualItems();
  const own = listItems || options ? "ui-virtual-rows ui-virtual-items" : "ui-virtual-rows";
  const run = {
    ...wears,
    ref: heldBlock,
    className: className === undefined ? own : `${own} ${className}`,
    "aria-label": label,
    onPointerDown,
    "data-row-drop-rows": dropRows,
    ...(moves ? motionRows() : {}),
    // Note that the row holding the keyboard is kept as it takes it and let go as it loses it, a row taking it from another being kept in its place.
    ...(holdsFocus
      ? {
          onFocus: (event: FocusEvent<HTMLElement>) => {
            focused.current =
              rowHolding(block.current, event.target)?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE) ??
              undefined;
            wears?.onFocus?.(event);
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
  if (options) {
    return (
      <div {...run}>
        {items.map((item) => (
          <Fragment key={item.key}>{children(item.index, placeOf(item))}</Fragment>
        ))}
      </div>
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
            style={place.style}
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
