import {
  type FocusEvent,
  type KeyboardEvent,
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";

export const ROVING_ORIENTATION = {
  VERTICAL: "vertical",
  HORIZONTAL: "horizontal",
  BOTH: "both",
} as const;

export type RovingOrientation = (typeof ROVING_ORIENTATION)[keyof typeof ROVING_ORIENTATION];

export const ROVING_STOP = {
  HELD: "held",
  CHOSEN: "chosen",
  NONE: "none",
} as const;

export type RovingStop = (typeof ROVING_STOP)[keyof typeof ROVING_STOP];

export const ROVING_REACH = {
  FIRST: "first",
  LAST: "last",
  NEXT: "next",
  PREVIOUS: "previous",
} as const;

export type RovingReach = (typeof ROVING_REACH)[keyof typeof ROVING_REACH];

const BOX_ATTRIBUTE = "data-roving";

const ITEM_ATTRIBUTE = "data-roving-item";

const STEP_KEYS = {
  [ROVING_ORIENTATION.VERTICAL]: { next: ["ArrowDown"], previous: ["ArrowUp"] },
  [ROVING_ORIENTATION.HORIZONTAL]: { next: ["ArrowRight"], previous: ["ArrowLeft"] },
  [ROVING_ORIENTATION.BOTH]: {
    next: ["ArrowDown", "ArrowRight"],
    previous: ["ArrowUp", "ArrowLeft"],
  },
} as const satisfies Record<
  RovingOrientation,
  { next: readonly string[]; previous: readonly string[] }
>;

const CHOSEN_ATTRIBUTES = ["aria-selected", "aria-checked"] as const;

const CURRENT_VALUES = ["page", "step", "true"] as const;

const WATCHED = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    "disabled",
    "aria-disabled",
    ITEM_ATTRIBUTE,
    ...CHOSEN_ATTRIBUTES,
    "aria-current",
  ],
} as const satisfies MutationObserverInit;

const NONE_SKIPPED = () => false;

function itemsOf(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(`[${ITEM_ATTRIBUTE}]`)).filter(
    (item) => item.parentElement?.closest(`[${BOX_ATTRIBUTE}]`) === box,
  );
}

function boxesOf(columns: HTMLElement): HTMLElement[] {
  return Array.from(columns.querySelectorAll<HTMLElement>(`[${BOX_ATTRIBUTE}]`)).filter(
    (box) => !columns.contains(box.parentElement?.closest(`[${BOX_ATTRIBUTE}]`) ?? null),
  );
}

function available(item: HTMLElement): boolean {
  return !item.matches(":disabled") && item.getAttribute("aria-disabled") !== "true";
}

function chosen(item: HTMLElement): boolean {
  return CHOSEN_ATTRIBUTES.some((name) => item.getAttribute(name) === "true");
}

function current(item: HTMLElement): boolean {
  return CURRENT_VALUES.some((value) => item.getAttribute("aria-current") === value);
}

function itemAt(box: HTMLElement, target: EventTarget): HTMLElement | undefined {
  if (!(target instanceof HTMLElement) || !target.hasAttribute(ITEM_ATTRIBUTE)) return undefined;
  return itemsOf(box).includes(target) ? target : undefined;
}

function landing(
  start: number,
  step: 1 | -1,
  count: number,
  skipped: (index: number) => boolean,
): number | undefined {
  for (let walked = 0; walked < count; walked += 1) {
    const at = (((start + step * walked) % count) + count) % count;
    if (!skipped(at)) return at;
  }
  return undefined;
}

export function rovingStep(
  key: string,
  orientation: RovingOrientation,
  at: number,
  count: number,
  skipped: (index: number) => boolean = NONE_SKIPPED,
): number | undefined {
  const step = STEP_KEYS[orientation];
  const forward = key === "Home" || step.next.some((each) => each === key);
  if (!forward && key !== "End" && !step.previous.some((each) => each === key)) return undefined;
  const edge = key === "Home" || key === "End" || at < 0;
  const start = edge ? (forward ? 0 : count - 1) : at + (forward ? 1 : -1);
  return landing(start, forward ? 1 : -1, count, skipped) ?? at;
}

export function reachedKey(
  keys: readonly string[],
  from: string | undefined,
  to: RovingReach,
): string | undefined {
  if (to === ROVING_REACH.FIRST) return keys[0];
  if (to === ROVING_REACH.LAST) return keys.at(-1);
  const at = from === undefined ? -1 : keys.indexOf(from);
  if (at < 0) return undefined;
  return keys[(at + (to === ROVING_REACH.NEXT ? 1 : keys.length - 1)) % keys.length];
}

function reachOf(key: string, orientation: RovingOrientation, at: number): RovingReach | undefined {
  if (key === "Home") return ROVING_REACH.FIRST;
  if (key === "End") return ROVING_REACH.LAST;
  const step = STEP_KEYS[orientation];
  if (step.next.some((each) => each === key)) {
    return at < 0 ? ROVING_REACH.FIRST : ROVING_REACH.NEXT;
  }
  if (step.previous.some((each) => each === key)) {
    return at < 0 ? ROVING_REACH.LAST : ROVING_REACH.PREVIOUS;
  }
  return undefined;
}

export function focusRovingStop(box: HTMLElement): boolean {
  const open = itemsOf(box).filter(available);
  const stop = open.find((item) => item.tabIndex === 0) ?? open[0];
  stop?.focus();
  return stop !== undefined;
}

export function rovingItem(): { readonly "data-roving-item": "" } {
  return { [ITEM_ATTRIBUTE]: "" };
}

export function rovingItemIn(row: Element): HTMLElement | undefined {
  return row.querySelector<HTMLElement>(`[${ITEM_ATTRIBUTE}]`) ?? undefined;
}

export interface RovingBox<T extends HTMLElement> {
  readonly "data-roving": "";
  readonly ref: RefCallback<T>;
  readonly onKeyDown: (event: KeyboardEvent<T>) => boolean;
  readonly onFocus: (event: FocusEvent<T>) => void;
}

function focusItem(item: HTMLElement): void {
  item.focus();
}

export function useRovingKeys<T extends HTMLElement>({
  orientation = ROVING_ORIENTATION.VERTICAL,
  stop = ROVING_STOP.HELD,
  moveTo = focusItem,
  reach,
}: {
  orientation?: RovingOrientation;
  stop?: RovingStop;
  moveTo?: (item: HTMLElement) => void;
  reach?: ((from: HTMLElement | undefined, to: RovingReach) => boolean) | undefined;
} = {}): RovingBox<T> {
  const held = useRef<HTMLElement | null>(null);
  const drawn = useRef<T | null>(null);
  const move = useRef(moveTo);
  move.current = moveTo;
  const reaching = useRef(reach);
  reaching.current = reach;

  const settle = useCallback(
    (box: HTMLElement) => {
      if (stop === ROVING_STOP.NONE) return;
      const items = itemsOf(box);
      const open = items.filter(available);
      const remembered = stop === ROVING_STOP.HELD ? held.current : null;
      const tabStop =
        remembered !== null && open.includes(remembered)
          ? remembered
          : (open.find(chosen) ?? open.find(current) ?? open[0]);
      for (const item of items) {
        const order = item === tabStop ? 0 : -1;
        if (!item.matches(":disabled")) {
          if (item.tabIndex !== order) item.tabIndex = order;
        } else if (item.getAttribute("tabindex") === "0") item.removeAttribute("tabindex");
      }
    },
    [stop],
  );

  const ref = useCallback(
    (box: T | null) => {
      if (box === null) return undefined;
      drawn.current = box;
      settle(box);
      const watcher = new MutationObserver(() => settle(box));
      watcher.observe(box, WATCHED);
      return () => {
        drawn.current = null;
        watcher.disconnect();
      };
    },
    [settle],
  );

  useLayoutEffect(() => {
    if (drawn.current !== null) settle(drawn.current);
  });

  const onFocus = useCallback(
    (event: FocusEvent<T>) => {
      const item = itemAt(event.currentTarget, event.target);
      if (item === undefined) return;
      held.current = item;
      settle(event.currentTarget);
    },
    [settle],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<T>): boolean => {
      if (event.defaultPrevented) return false;
      if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false;
      const box = event.currentTarget;
      const onBox = event.target === box;
      const item = itemAt(box, onBox ? (document.activeElement ?? box) : event.target);
      if (item === undefined && !onBox) return false;
      const open = itemsOf(box).filter(available);
      const at = item === undefined ? -1 : open.indexOf(item);
      const to = rovingStep(event.key, orientation, at, open.length);
      if (to === undefined) return false;
      const reached = reachOf(event.key, orientation, at);
      if (reached !== undefined && reaching.current?.(item, reached) === true) {
        event.preventDefault();
        return true;
      }
      event.preventDefault();
      const landed = open[to];
      if (landed !== undefined) move.current(landed);
      return true;
    },
    [orientation],
  );

  return { [BOX_ATTRIBUTE]: "", ref, onKeyDown, onFocus };
}

export interface RovingColumns<T extends HTMLElement> {
  readonly onKeyDown: (event: KeyboardEvent<T>) => boolean;
}

export function useRovingColumns<T extends HTMLElement>(): RovingColumns<T> {
  const onKeyDown = useCallback((event: KeyboardEvent<T>): boolean => {
    if (event.defaultPrevented) return false;
    if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false;
    const across = STEP_KEYS[ROVING_ORIENTATION.HORIZONTAL];
    if (![...across.next, ...across.previous].some((each) => each === event.key)) return false;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.hasAttribute(ITEM_ATTRIBUTE)) return false;
    const columns = boxesOf(event.currentTarget);
    const from = target.parentElement?.closest<HTMLElement>(`[${BOX_ATTRIBUTE}]`) ?? null;
    const at = from === null ? -1 : columns.indexOf(from);
    if (at < 0) return false;
    const empty = (index: number) => {
      const column = columns[index];
      return column === undefined || !itemsOf(column).some(available);
    };
    const to = rovingStep(event.key, ROVING_ORIENTATION.HORIZONTAL, at, columns.length, empty);
    const column = to === undefined || to === at ? undefined : columns[to];
    if (column === undefined) return false;
    event.preventDefault();
    focusRovingStop(column);
    return true;
  }, []);
  return { onKeyDown };
}
