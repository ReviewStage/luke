/**
 * use-tab-drag.ts -- a tab strip's tabs dragged to another place along it, as an editor's or a browser's are.
 *
 * A press on a tab is a click until the pointer has gone a few pixels along
 * the strip; past that the tab is lifted and follows the pointer, held
 * within the strip, and the tabs it passes slide aside to show where it
 * will land. Letting go puts it there and chooses it, as Chrome and VS Code
 * choose a tab the developer drags; Escape, or the system taking the
 * pointer away, puts every tab back and changes nothing.
 *
 * The drag is drawn on the tabs' own `transform` and nothing else, and the
 * stylesheet (desktop.css) times every slide from the motion tokens, so
 * reduced motion and a capture run hold it still as they hold the rest.
 * Only the drop reaches the strip's owner, as one move.
 *
 * The drag is pointer events with the pointer captured, never the
 * browser's drag and drop: that draws a picture of its own under the
 * pointer and fights the window's drag region the tabs stand in. The × on
 * a tab is a button of its own and starts no drag.
 */

import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";

/** How far the pointer goes along the strip, in CSS pixels, before a press is a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/** The strip's tabs, each the element that moves: the pill holding the tab and its ×. */
const TAB_PILL = ":scope > .tab";

/** What a tab and its strip wear while a drag lasts; desktop.css lifts the one and slides the others. */
const DRAGGING_ATTRIBUTE = "data-dragging";

/** A tab's place in the strip as laid out when the press began, before anything moved. */
interface Slot {
  left: number;
  width: number;
}

/**
 * A press on a tab, and the drag it became once it went far enough: the
 * pointer, where it began, the strip's tabs and their slots, the space
 * between two of them, the room the tab travels in, and where it would land now.
 */
interface TabPress {
  pointerId: number;
  x: number;
  at: number;
  tabs: HTMLElement[];
  slots: Slot[];
  gap: number;
  room: Slot;
  to: number;
  dragging: boolean;
}

/** What the strip's owner hears from a drop: the tab at `from` now stands at `to`, which differs from it. */
export type TabMove = (from: number, to: number) => void;

/** The space between two tabs, read from how far the tabs run past their own widths. */
function tabGap(slots: readonly Slot[]): number {
  const first = slots[0];
  const last = slots.at(-1);
  if (first === undefined || last === undefined || slots.length < 2) return 0;
  const widths = slots.reduce((sum, slot) => sum + slot.width, 0);
  return (last.left + last.width - first.left - widths) / (slots.length - 1);
}

/**
 * The room a tab travels in: from the first tab to the last, and no further
 * than the strip shows, where it has scrolled some of them out of sight.
 */
function travelRoom(strip: HTMLElement, slots: readonly Slot[]): Slot {
  const shown = strip.getBoundingClientRect();
  const first = slots[0];
  const last = slots.at(-1);
  if (first === undefined || last === undefined) return { left: 0, width: 0 };
  const left = Math.max(first.left, shown.left);
  return { left, width: Math.min(last.left + last.width, shown.right) - left };
}

/** The pressed tab's travel for the pointer at `x`, held so the tab stays within its room. */
function travel(press: TabPress, x: number): number {
  const own = press.slots[press.at];
  if (own === undefined) return 0;
  const least = press.room.left - own.left;
  const most = press.room.left + press.room.width - own.left - own.width;
  return Math.max(least, Math.min(most, x - press.x));
}

/**
 * Where the pressed tab lands with its middle at `middle`: after every other
 * tab whose middle it stands past. Reaching a tab's middle is crossing it,
 * from either side, so a tab held at the strip's end lands at that end.
 */
function landing(press: TabPress, middle: number): number {
  return press.slots.filter((slot, index) => {
    const crossing = slot.left + slot.width / 2;
    return index < press.at ? middle > crossing : index > press.at && middle >= crossing;
  }).length;
}

/** How far the tab at `index` slides aside to leave the pressed tab its landing. */
function aside(press: TabPress, index: number): number {
  const room = (press.slots[press.at]?.width ?? 0) + press.gap;
  if (index > press.at && index <= press.to) return -room;
  if (index < press.at && index >= press.to) return room;
  return 0;
}

/** Draws the drag with the pressed tab `moved` along: it follows, and those it passed stand aside. */
function draw(press: TabPress, moved: number): void {
  const own = press.slots[press.at];
  if (own === undefined) return;
  press.to = landing(press, own.left + own.width / 2 + moved);
  press.tabs.forEach((tab, index) => {
    const shift = index === press.at ? moved : aside(press, index);
    tab.style.transform = shift === 0 ? "" : `translateX(${shift}px)`;
  });
}

/**
 * Takes the drag down. Note that a put-back lets every tab slide home on
 * the stylesheet's timing, while a drop clears the tabs at once, because
 * the strip has already been drawn in its new order beneath them and the
 * tabs that stood aside are now where they were drawn.
 */
function lower(press: TabPress, strip: HTMLElement, settle: boolean): void {
  for (const tab of press.tabs) {
    tab.removeAttribute(DRAGGING_ATTRIBUTE);
    if (!settle) tab.style.transition = "none";
    tab.style.transform = "";
  }
  strip.removeAttribute(DRAGGING_ATTRIBUTE);
  if (settle) return;
  // Laid out with no transition, so letting the transition back plays nothing.
  strip.getBoundingClientRect();
  for (const tab of press.tabs) tab.style.transition = "";
}

/**
 * Plays the dropped tab from where it was let go, `left`, into the place
 * the new order gave it, as the tabs beside it already stand.
 */
function settleDropped(tab: HTMLElement, left: number): void {
  const shift = left - tab.getBoundingClientRect().left;
  if (shift === 0) return;
  tab.style.transition = "none";
  tab.style.transform = `translateX(${shift}px)`;
  tab.getBoundingClientRect();
  tab.style.transition = "";
  tab.style.transform = "";
}

/**
 * The strip's drag: spread `onPointerDown` on the strip. A press is heard at
 * the window from then on, so it outlives the pointer leaving the strip, and
 * the pointer is captured only once the press is a drag, so a press that
 * stays a click lands on the tab as any click does.
 */
export function useTabDrag(
  onMove: TabMove | undefined,
): React.PointerEventHandler<HTMLElement> | undefined {
  const latest = useRef(onMove);
  const release = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = onMove;
  });
  useEffect(() => () => release.current?.(), []);
  if (onMove === undefined) return undefined;

  const begin = (strip: HTMLElement, press: TabPress) => {
    const pressed = () => press.tabs[press.at];
    const move = (event: PointerEvent) => {
      if (event.pointerId !== press.pointerId) return;
      if (!press.dragging && Math.abs(event.clientX - press.x) < DRAG_THRESHOLD) return;
      if (!press.dragging) {
        press.dragging = true;
        strip.setPointerCapture(press.pointerId);
        strip.setAttribute(DRAGGING_ATTRIBUTE, "true");
        pressed()?.setAttribute(DRAGGING_ATTRIBUTE, "true");
      }
      draw(press, travel(press, event.clientX));
    };
    const putBack = () => {
      release.current?.();
      if (press.dragging) lower(press, strip, true);
    };
    const drop = (event: PointerEvent) => {
      if (event.pointerId !== press.pointerId) return;
      release.current?.();
      const tab = pressed();
      if (!press.dragging || tab === undefined) return;
      // A tab opened or closed under the drag leaves its places stale, so
      // the drag is put back rather than dropped at a place that moved.
      const now = [...strip.querySelectorAll<HTMLElement>(TAB_PILL)];
      if (now.length !== press.tabs.length || now.some((each, at) => each !== press.tabs[at])) {
        lower(press, strip, true);
        return;
      }
      const left = tab.getBoundingClientRect().left;
      // Note that the strip is drawn in its new order, the tab chosen, before
      // the tabs come down, so they come down where that drew them. The tab
      // is chosen as a press on it chooses it, because the captured
      // pointer's own click lands on the strip rather than on the tab.
      flushSync(() => {
        if (press.to !== press.at) latest.current?.(press.at, press.to);
        tab.querySelector<HTMLElement>('[role="tab"]')?.click();
      });
      lower(press, strip, false);
      settleDropped(tab, left);
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === press.pointerId) putBack();
    };
    // Escape puts a drag back, and is the drag's alone while it lasts, so it
    // steps the window back no layer as well.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !press.dragging) return;
      event.preventDefault();
      event.stopPropagation();
      putBack();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", drop, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", onEscape, true);
    release.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", drop, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", onEscape, true);
      release.current = undefined;
    };
  };

  return (event) => {
    const strip = event.currentTarget;
    const target = event.target instanceof Element ? event.target : null;
    if (event.button !== 0 || release.current !== undefined || target === null) return;
    if (target.closest(".tab-close, [data-editing]") !== null) return;
    const tabs = [...strip.querySelectorAll<HTMLElement>(TAB_PILL)];
    const at = tabs.findIndex((tab) => tab.contains(target));
    if (at < 0 || tabs.length < 2) return;
    const slots = tabs.map((tab) => {
      const rect = tab.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    });
    const press = { pointerId: event.pointerId, x: event.clientX, at, tabs, slots, to: at };
    begin(strip, { ...press, gap: tabGap(slots), room: travelRoom(strip, slots), dragging: false });
  };
}
