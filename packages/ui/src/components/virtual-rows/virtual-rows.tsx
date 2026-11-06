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

export const VIRTUAL_ROW_KEY_ATTRIBUTE = "data-row-key";

export interface VirtualRowsHandle {
  readonly bringIn: (key: string, then?: (row: HTMLElement) => void) => boolean;
  readonly rowElement: (key: string) => HTMLElement | undefined;
  readonly drawnKeys: () => readonly string[];
  readonly keys: () => readonly string[];
  readonly scrollToEnd: () => void;
}

export interface VirtualRuns {
  readonly hold: (run: RefObject<VirtualRowsHandle | null>) => () => void;
  readonly bringIn: (key: string, then?: (row: HTMLElement) => void) => boolean;
  readonly keys: () => readonly string[];
}

interface Bringing {
  readonly key: string;
  readonly drawn: ((row: HTMLElement) => void) | undefined;
}

const DEFAULT_OVERSCAN = 4;

const END_THRESHOLD_PX = 80;

export interface VirtualRowsBlock {
  readonly ref?: Ref<HTMLElement> | undefined;
  readonly id?: string | undefined;
  readonly onKeyDown?: KeyboardEventHandler<HTMLElement> | undefined;
  readonly onFocus?: ((event: FocusEvent<HTMLElement>) => void) | undefined;
  readonly [data: `data-${string}`]: string | undefined;
}

const ROW_STYLE: CSSProperties = { position: "absolute", insetInline: 0 };

export const VIRTUAL_ROWS_ANCHOR = {
  START: "start",
  END: "end",
} as const;

export type VirtualRowsAnchor = (typeof VIRTUAL_ROWS_ANCHOR)[keyof typeof VIRTUAL_ROWS_ANCHOR];

export type VirtualRowMeasurements = readonly VirtualItem[];

const NO_MEASUREMENTS: VirtualRowMeasurements = [];

export interface VirtualRowPlace {
  readonly ref: (element: HTMLElement | null) => void;
  readonly style: CSSProperties;
  readonly "data-index": number;
  readonly "data-row-key": string;
  readonly "aria-setsize": number;
  readonly "aria-posinset": number;
}

export function sizeWhileShown<Item extends Element>(
  instance: Virtualizer<HTMLElement, Item>,
  hear: (rect: Rect) => void,
): (() => void) | undefined {
  return observeElementRect(instance, (rect) => {
    if (rect.height > 0) hear(rect);
  });
}

function windowRect(): Rect {
  return { width: window.innerWidth, height: window.innerHeight };
}

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

function offsetWithin(block: HTMLElement, scroller: HTMLElement): number {
  let holder = block.offsetParent;
  while (holder instanceof HTMLElement && holder !== scroller && !holder.contains(scroller)) {
    holder = holder.offsetParent;
  }
  return holder === scroller
    ? offsetTo(block, scroller)
    : offsetTo(block, holder) - offsetTo(scroller, holder) - scroller.clientTop;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, at) => key === b[at]);
}

function useSteadyKeys(keys: readonly string[]): readonly string[] {
  const held = useRef(keys);
  if (held.current !== keys && !sameKeys(held.current, keys)) held.current = keys;
  return held.current;
}

function rowClassOf(
  rowClassName: string | ((index: number) => string) | undefined,
  index: number,
): string {
  const own = typeof rowClassName === "function" ? rowClassName(index) : rowClassName;
  return own === undefined ? "ui-virtual-row" : `ui-virtual-row ${own}`;
}

function rowHolding(block: HTMLElement | null, target: EventTarget): Element | undefined {
  if (block === null || !(target instanceof Element)) return undefined;
  let at: Element | null = target;
  while (at !== null && at.parentElement !== block) at = at.parentElement;
  return at ?? undefined;
}

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
  measurements = NO_MEASUREMENTS,
  onMeasurements,
  children,
}: {
  scroller: RefObject<HTMLElement | null>;
  keys: readonly string[];
  estimate: number;
  gap?: number;
  overscan?: number | undefined;
  anchor?: VirtualRowsAnchor;
  listItems?: boolean;
  options?: boolean;
  moves?: boolean;
  holdsFocus?: boolean;
  shiftedBy?: RefObject<HTMLElement | null> | undefined;
  onAtEnd?: ((atEnd: boolean) => void) | undefined;
  className?: string | undefined;
  rowClassName?: string | ((index: number) => string) | undefined;
  handle?: RefObject<VirtualRowsHandle | null> | undefined;
  "aria-label"?: string | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  "data-row-drop-rows"?: "" | undefined;
  block?: VirtualRowsBlock | undefined;
  measurements?: VirtualRowMeasurements | undefined;
  onMeasurements?: ((measured: VirtualRowMeasurements) => void) | undefined;
  children: (index: number, place: VirtualRowPlace) => ReactNode;
}): ReactNode {
  const block = useRef<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  const latestKeys = useRef(keys);
  latestKeys.current = keys;
  const steady = useSteadyKeys(keys);
  const getItemKey = useCallback((index: number) => steady[index] ?? index, [steady]);
  const fromEnd = anchor === VIRTUAL_ROWS_ANCHOR.END;
  const focused = useRef<string | undefined>(undefined);
  const rangeExtractor = useCallback((range: Range) => {
    const drawn = defaultRangeExtractor(range);
    const key = focused.current;
    const at = key === undefined ? -1 : latestKeys.current.indexOf(key);
    if (at < 0 || drawn.includes(at)) return drawn;
    return [...drawn, at].sort((a, b) => a - b);
  }, []);
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
    initialMeasurementsCache: [...measurements],
    initialOffset: () => scroller.current?.scrollTop ?? 0,
    measureElement: measured,
    observeElementRect: sizeWhileShown,
    initialRect: windowRect(),
    onChange: (instance) => onAtEnd?.(instance.isAtEnd()),
    useFlushSync: false,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
  });
  const heard = useRef(onMeasurements);
  heard.current = onMeasurements;
  useEffect(() => () => heard.current?.(Array.from(virtualizer.measurementsCache)), [virtualizer]);
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
  const [sized, setSized] = useState(0);
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
  useLayoutEffect(() => {
    const asked = bringing.current;
    if (asked === undefined) return;
    const row = rowElement(asked.key);
    if (row === undefined) return;
    bringing.current = undefined;
    asked.drawn?.(row);
  });
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
