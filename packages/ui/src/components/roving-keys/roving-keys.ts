import { type FocusEvent, type KeyboardEvent, type RefCallback, useCallback, useRef } from "react";

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
 * itself, still has the last word.
 *
 * The box keeps the tab order in the DOM rather than in a render, because
 * its items are drawn by whoever fills it: it settles the order when it is
 * drawn, whenever an item comes, goes, or turns unavailable, and whenever
 * the focus lands on one. An item therefore renders no `tabIndex` of its
 * own, which React would put back over the box's.
 */

/** Which arrows step through the set: ↑↓ down a column, ←→ along a row. */
export const ROVING_ORIENTATION = {
  VERTICAL: "vertical",
  HORIZONTAL: "horizontal",
} as const;

export type RovingOrientation = (typeof ROVING_ORIENTATION)[keyof typeof ROVING_ORIENTATION];

/** The attribute the box wears, so an item finds the set it belongs to and no set a box inside it holds. */
const BOX_ATTRIBUTE = "data-roving";

/** The attribute an item wears. */
const ITEM_ATTRIBUTE = "data-roving-item";

/** The keys that step forward and back, by orientation. */
const STEP_KEYS = {
  [ROVING_ORIENTATION.VERTICAL]: { next: "ArrowDown", previous: "ArrowUp" },
  [ROVING_ORIENTATION.HORIZONTAL]: { next: "ArrowRight", previous: "ArrowLeft" },
} as const satisfies Record<RovingOrientation, { next: string; previous: string }>;

/** What a change under the box settles the tab order on: an item coming, going, or turning unavailable. */
const WATCHED = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["disabled", "aria-disabled", ITEM_ATTRIBUTE],
} as const satisfies MutationObserverInit;

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

/** The item of the box an event landed on, where it landed on one. */
function itemAt(box: HTMLElement, target: EventTarget): HTMLElement | undefined {
  if (!(target instanceof HTMLElement) || !target.hasAttribute(ITEM_ATTRIBUTE)) return undefined;
  return itemsOf(box).includes(target) ? target : undefined;
}

/** The index a key moves to among `count` available items from `at`, wrapping at the ends; none for a key that moves nothing. */
function stepped(
  key: string,
  orientation: RovingOrientation,
  at: number,
  count: number,
): number | undefined {
  const step = STEP_KEYS[orientation];
  if (key === step.next) return (at + 1) % count;
  if (key === step.previous) return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}

/** What an item of a roving set wears, spread on the element that takes the focus. */
export function rovingItem(): { readonly "data-roving-item": "" } {
  return { [ITEM_ATTRIBUTE]: "" };
}

/** What the box of a roving set takes, spread on it: its ref and the keys and focus it hears. */
export interface RovingBox<T extends HTMLElement> {
  readonly "data-roving": "";
  readonly ref: RefCallback<T>;
  readonly onKeyDown: (event: KeyboardEvent<T>) => void;
  readonly onFocus: (event: FocusEvent<T>) => void;
}

/** One Tab stop over the items a box holds, the arrows along `orientation`, Home, and End walking them. */
export function useRovingKeys<T extends HTMLElement>({
  orientation = ROVING_ORIENTATION.VERTICAL,
}: {
  orientation?: RovingOrientation;
} = {}): RovingBox<T> {
  // The item last focused, which stays the Tab stop while it stands and is available.
  const held = useRef<HTMLElement | null>(null);

  const settle = useCallback((box: HTMLElement) => {
    const items = itemsOf(box);
    const open = items.filter(available);
    const stop = held.current !== null && open.includes(held.current) ? held.current : open[0];
    for (const item of items) {
      const order = item === stop ? 0 : -1;
      // Note that a disabled control is out of the order already, and keeps no tabindex that would offer it the focus.
      if (item.matches(":disabled")) item.removeAttribute("tabindex");
      else if (item.tabIndex !== order) item.tabIndex = order;
    }
  }, []);

  const ref = useCallback(
    (box: T | null) => {
      if (box === null) return undefined;
      settle(box);
      const watcher = new MutationObserver(() => settle(box));
      watcher.observe(box, WATCHED);
      return () => watcher.disconnect();
    },
    [settle],
  );

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
    (event: KeyboardEvent<T>) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      const box = event.currentTarget;
      const item = itemAt(box, event.target);
      if (item === undefined) return;
      const open = itemsOf(box).filter(available);
      const to = stepped(event.key, orientation, open.indexOf(item), open.length);
      if (to === undefined) return;
      event.preventDefault();
      open[to]?.focus();
    },
    [orientation],
  );

  return { [BOX_ATTRIBUTE]: "", ref, onKeyDown, onFocus };
}
