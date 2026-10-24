import {
  type FocusEvent,
  type KeyboardEvent,
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";

/**
 * roving-keys.ts -- one Tab stop for a set of items, the arrows walking between them, as a Mac's list or a toolbar's buttons are walked.
 *
 * A box (`useRovingKeys`) holds its items, each marked by `rovingItem()`.
 * Exactly one of them is a Tab stop: the one last focused, or the first
 * while none has been, and every other is out of the tab order, so Tab
 * enters the set once and leaves it at the next. The arrows along the
 * set's orientation (↑↓, or ←→ for a row of items) step the focus to the
 * next or previous item, wrapping at either end, and Home and End go to the
 * first and the last. An item unavailable (`disabled`, `aria-disabled`) is
 * stepped over and never the Tab stop.
 *
 * Note that a key held with ⌘, ⌥, Ctrl, or ⇧ is left alone, because those
 * are the app's own shortcuts (⇧⌘↑ moves a row, ⌘↓ goes to the end), and so
 * is a key an item's own handler already took (`defaultPrevented`), so a
 * list that steers its rows from a field, or a row that answers a key
 * itself, still has the last word. A key heard on the box itself steps
 * from the item holding the focus, or, while the focus stands on none of
 * them, from none: forward and Home to the first, back and End to the last.
 *
 * A set may differ in three ways, each an option rather than a copy of the
 * walk. A radio group steps by either pair of arrows (`BOTH`). A set where
 * one item is chosen, a tablist or a radio group, keeps its Tab stop on the
 * chosen one rather than the one last focused (`ROVING_STOP.CHOSEN`), and a
 * set whose tab order a library or its owner keeps, a menu's or a group of
 * checkboxes each a stop, takes the keys alone (`ROVING_STOP.NONE`). And a
 * set that does more as a key lands, a strip of tabs scrolling the tab into
 * view or a radio group choosing as it goes, moves the focus itself
 * (`moveTo`). A list that steps a highlight while the focus stays in a
 * field moves no focus at all, and takes the walk alone (`rovingStep`).
 *
 * The box keeps the tab order in the DOM rather than in a render, because
 * its items are drawn by whoever fills it: it settles the order whenever
 * its owner draws it, whenever an item comes, goes, turns unavailable, or
 * is chosen, and whenever the focus lands on one. An item therefore renders no `tabIndex` of its
 * own, which React would put back over the box's.
 */

/** Which arrows step through the set: ↑↓ down a column, ←→ along a row, or either pair, as a radio group takes them. */
export const ROVING_ORIENTATION = {
  VERTICAL: "vertical",
  HORIZONTAL: "horizontal",
  BOTH: "both",
} as const;

export type RovingOrientation = (typeof ROVING_ORIENTATION)[keyof typeof ROVING_ORIENTATION];

/** Which item is the set's one Tab stop: the one last focused, the one chosen, or none the box keeps, its owner keeping the tab order. */
export const ROVING_STOP = {
  HELD: "held",
  CHOSEN: "chosen",
  NONE: "none",
} as const;

export type RovingStop = (typeof ROVING_STOP)[keyof typeof ROVING_STOP];

/** The attribute the box wears, so an item finds the set it belongs to and no set a box inside it holds. */
const BOX_ATTRIBUTE = "data-roving";

/** The attribute an item wears. */
const ITEM_ATTRIBUTE = "data-roving-item";

/** The keys that step forward and back, by orientation. */
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

/** The attributes that say an item is the chosen one: a tab's, or a radio's. */
const CHOSEN_ATTRIBUTES = ["aria-selected", "aria-checked"] as const;

/** What a change under the box settles the tab order on: an item coming, going, turning unavailable, or chosen. */
const WATCHED = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["disabled", "aria-disabled", ITEM_ATTRIBUTE, ...CHOSEN_ATTRIBUTES],
} as const satisfies MutationObserverInit;

const NONE_SKIPPED = () => false;

/** The items of the set the box holds, in the order they are drawn, none of a set nested inside it. */
function itemsOf(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(`[${ITEM_ATTRIBUTE}]`)).filter(
    (item) => item.parentElement?.closest(`[${BOX_ATTRIBUTE}]`) === box,
  );
}

/** Whether an item can take the focus. */
function available(item: HTMLElement): boolean {
  return !item.matches(":disabled") && item.getAttribute("aria-disabled") !== "true";
}

/** Whether an item is the chosen one of its set. */
function chosen(item: HTMLElement): boolean {
  return CHOSEN_ATTRIBUTES.some((name) => item.getAttribute(name) === "true");
}

/** The item of the box an event landed on, where it landed on one. */
function itemAt(box: HTMLElement, target: EventTarget): HTMLElement | undefined {
  if (!(target instanceof HTMLElement) || !target.hasAttribute(ITEM_ATTRIBUTE)) return undefined;
  return itemsOf(box).includes(target) ? target : undefined;
}

/** The first index from `start` on, `step` at a time and wrapping, that is not skipped; none where every one of `count` is. */
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

/**
 * The index a key moves to among `count` items from `at` (below zero for
 * none), as a roving set walks them: the arrows along `orientation` a step
 * on, wrapping at either end, and from none to the first or the last; Home
 * and End to the first and the last. An item `skipped` is passed over, and
 * where every one is, the key stays at `at`. A key that moves nothing
 * answers none. It reads no modifier, which is its caller's to refuse.
 */
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

/** Hands the focus to the Tab stop of the set `box` holds, as Tab entering it would; answers whether one took it. */
export function focusRovingStop(box: HTMLElement): boolean {
  const stop = itemsOf(box).find((item) => item.tabIndex === 0 && available(item));
  stop?.focus();
  return stop !== undefined;
}

/** What an item of a roving set wears, spread on the element that takes the focus. */
export function rovingItem(): { readonly "data-roving-item": "" } {
  return { [ITEM_ATTRIBUTE]: "" };
}

/** What the box of a roving set takes, spread on it: its ref and the keys and focus it hears; its key handler says whether the key stepped. */
export interface RovingBox<T extends HTMLElement> {
  readonly "data-roving": "";
  readonly ref: RefCallback<T>;
  readonly onKeyDown: (event: KeyboardEvent<T>) => boolean;
  readonly onFocus: (event: FocusEvent<T>) => void;
}

/** Moves the focus to the item a key landed on, as a set does unless it says otherwise. */
function focusItem(item: HTMLElement): void {
  item.focus();
}

/**
 * One Tab stop over the items a box holds, the arrows along `orientation`,
 * Home, and End walking them. `stop` says which item is the Tab stop, and
 * `moveTo` takes the focus to the item a key lands on, and does whatever
 * else the set does as it lands.
 */
export function useRovingKeys<T extends HTMLElement>({
  orientation = ROVING_ORIENTATION.VERTICAL,
  stop = ROVING_STOP.HELD,
  moveTo = focusItem,
}: {
  orientation?: RovingOrientation;
  stop?: RovingStop;
  moveTo?: (item: HTMLElement) => void;
} = {}): RovingBox<T> {
  // The item last focused, which stays the Tab stop while it stands and is available.
  const held = useRef<HTMLElement | null>(null);
  // The box while it stands, settled again each time its owner draws it.
  const drawn = useRef<T | null>(null);
  // The latest `moveTo`, which a caller may hand anew on every render.
  const move = useRef(moveTo);
  move.current = moveTo;

  const settle = useCallback(
    (box: HTMLElement) => {
      if (stop === ROVING_STOP.NONE) return;
      const items = itemsOf(box);
      const open = items.filter(available);
      const kept = stop === ROVING_STOP.CHOSEN ? open.find(chosen) : held.current;
      const tabStop = kept !== null && kept !== undefined && open.includes(kept) ? kept : open[0];
      for (const item of items) {
        const order = item === tabStop ? 0 : -1;
        // Note that a disabled control is out of the order already: one
        // that stood as the stop gives up its tabindex rather than keep one
        // that would offer it the focus, and any other is left as drawn.
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

  // Note that the order is settled as the owner's render lands too, rather
  // than only once the watcher hears of it, so an item chosen in that render
  // is the Tab stop before anything reads the order.
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
      // Note that a key heard on the box itself steps from the item holding the focus, or from none.
      const onBox = event.target === box;
      const item = itemAt(box, onBox ? (document.activeElement ?? box) : event.target);
      if (item === undefined && !onBox) return false;
      const open = itemsOf(box).filter(available);
      const at = item === undefined ? -1 : open.indexOf(item);
      const to = rovingStep(event.key, orientation, at, open.length);
      if (to === undefined) return false;
      event.preventDefault();
      const landed = open[to];
      if (landed !== undefined) move.current(landed);
      return true;
    },
    [orientation],
  );

  return { [BOX_ATTRIBUTE]: "", ref, onKeyDown, onFocus };
}
