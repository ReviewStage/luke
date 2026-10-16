/**
 * use-tab-drag.ts -- a tab strip's tabs dragged to another place along it, as an editor's or a browser's are.
 *
 * A press on a tab is a click until the pointer has gone a few pixels along
 * the strip; past that the tab is lifted and follows the pointer, held
 * within the strip, and the tabs it passes slide aside to show where it
 * will land: past a tab once its leading edge crosses that tab's middle, so
 * a tab of any width reaches either end. Held at an edge the strip hides
 * tabs beyond, it runs the strip along toward them, as VS Code's does.
 * Letting go puts it there and chooses it, as Chrome and VS Code choose a
 * tab the developer drags; Escape, or the system taking the pointer away,
 * puts every tab back and changes nothing. Every tab moves, to any place
 * among them all, but one anchored at the strip's start, which is pressed
 * as a click and never moved, nor passed.
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

/** The strip's tabs that move, each the pill holding the tab and its ×: all but one anchored at its start. */
const TAB_PILL = ':scope > .tab:not([data-anchored="true"])';

/** What a tab and its strip wear while a drag lasts; desktop.css lifts the one and slides the others. */
const DRAGGING_ATTRIBUTE = "data-dragging";

/** How near the strip's edge, in CSS pixels, the pointer runs the strip along: about its faded edge. */
const EDGE_REACH = 32;

/** The most the strip runs along in a frame, in CSS pixels, with the pointer at its edge or past it. */
const EDGE_SPEED = 12;

/**
 * A stretch along the strip. A tab's is its place as laid out when the
 * press began, measured from the start of the strip's scrolled row, so a
 * scroll during the drag moves no slot; the strip's own is its box on screen.
 */
interface Slot {
  left: number;
  width: number;
}

/**
 * A press on a tab, and the drag it became once it went far enough: the
 * pointer, where it began and where it is now, how far the strip had
 * scrolled, the strip's box, the tabs that move and their slots, the space
 * between two of them, where the pressed tab would land now, and the frame
 * that next runs the strip along, while one is asked for.
 */
interface TabPress {
  pointerId: number;
  x: number;
  pointer: number;
  scrolled: number;
  view: Slot;
  at: number;
  tabs: HTMLElement[];
  slots: Slot[];
  gap: number;
  to: number;
  dragging: boolean;
  frame: number | undefined;
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
 * The pressed tab's travel along the row, with the strip scrolled to
 * `scrollLeft`: the pointer's own, and the strip's scrolling since the
 * press, so the tab stays under the pointer as the row runs beneath it.
 * It is held between the first tab that moves and the last, and within
 * what the strip shows, though never off a place it already stands.
 */
function travel(press: TabPress, scrollLeft: number): number {
  const own = press.slots[press.at];
  const first = press.slots[0];
  const last = press.slots.at(-1);
  if (own === undefined || first === undefined || last === undefined) return 0;
  const least = Math.min(0, Math.max(first.left, scrollLeft) - own.left);
  const most = Math.max(
    0,
    Math.min(last.left + last.width, scrollLeft + press.view.width) - own.left - own.width,
  );
  const moved = press.pointer - press.x + scrollLeft - press.scrolled;
  return Math.max(least, Math.min(most, moved));
}

/**
 * Where the pressed tab lands, `moved` along: past every tab whose middle
 * its leading edge has crossed, its left edge for a tab before it and its
 * right edge for one after. Note that it is the edge and not the tab's own
 * middle, because the tab is held between the first tab and the last, and
 * a tab wider than the one at the end could never bring its middle past
 * that one's.
 */
function landing(press: TabPress, moved: number): number {
  const own = press.slots[press.at];
  if (own === undefined) return press.at;
  const left = own.left + moved;
  const right = left + own.width;
  return press.slots.filter((slot, index) => {
    const crossing = slot.left + slot.width / 2;
    return index < press.at ? left > crossing : index > press.at && right >= crossing;
  }).length;
}

/**
 * How far the strip runs along this frame, toward the tabs that move which
 * it hides past the edge the pointer is held at: faster the nearer the
 * edge, the whole of `EDGE_SPEED` at it or past it, and none away from
 * both edges or with no such tab hidden that way.
 */
function edgeRun(press: TabPress, scrollLeft: number): number {
  const first = press.slots[0];
  const last = press.slots.at(-1);
  if (first === undefined || last === undefined) return 0;
  const before = press.view.left + EDGE_REACH - press.pointer;
  const after = press.pointer - (press.view.left + press.view.width - EDGE_REACH);
  const speed = (into: number) => Math.ceil(EDGE_SPEED * Math.min(1, into / EDGE_REACH));
  if (before > 0 && first.left < scrollLeft) return -speed(before);
  if (after > 0 && last.left + last.width > scrollLeft + press.view.width) return speed(after);
  return 0;
}

/** How far the tab at `index` slides aside to leave the pressed tab its landing. */
function aside(press: TabPress, index: number): number {
  const room = (press.slots[press.at]?.width ?? 0) + press.gap;
  if (index > press.at && index <= press.to) return -room;
  if (index < press.at && index >= press.to) return room;
  return 0;
}

/** Draws the drag where the pointer has it: the pressed tab follows, and those it passed stand aside. */
function draw(press: TabPress, strip: HTMLElement): void {
  const moved = travel(press, strip.scrollLeft);
  press.to = landing(press, moved);
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
    // Note that the strip is run along at once rather than gliding, because
    // a glide would be restarted, and cut short, by every frame.
    const runAlong = () => {
      press.frame = undefined;
      const from = strip.scrollLeft;
      const by = edgeRun(press, from);
      if (!press.dragging || by === 0) return;
      strip.style.scrollBehavior = "auto";
      strip.scrollLeft = from + by;
      strip.style.scrollBehavior = "";
      // A strip already at its end stops running however the pointer is held.
      if (strip.scrollLeft === from) return;
      draw(press, strip);
      press.frame = requestAnimationFrame(runAlong);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== press.pointerId) return;
      if (!press.dragging && Math.abs(event.clientX - press.x) < DRAG_THRESHOLD) return;
      if (!press.dragging) {
        press.dragging = true;
        strip.setPointerCapture(press.pointerId);
        strip.setAttribute(DRAGGING_ATTRIBUTE, "true");
        pressed()?.setAttribute(DRAGGING_ATTRIBUTE, "true");
      }
      press.pointer = event.clientX;
      draw(press, strip);
      if (press.frame === undefined) press.frame = requestAnimationFrame(runAlong);
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
    // The row run along under a pointer held still, by a wheel or by the
    // strip bringing a tab into view, moves where the tab would land.
    const runBeneath = () => {
      if (press.dragging) draw(press, strip);
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
    strip.addEventListener("scroll", runBeneath);
    release.current = () => {
      if (press.frame !== undefined) cancelAnimationFrame(press.frame);
      press.frame = undefined;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", drop, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", onEscape, true);
      strip.removeEventListener("scroll", runBeneath);
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
    const shown = strip.getBoundingClientRect();
    const view = { left: shown.left, width: shown.width };
    const scrolled = strip.scrollLeft;
    // Note that each slot is laid from the strip's start by the widths before
    // it, rather than read off where the tab is drawn, because the chosen tab
    // is pinned at the strip's edge (desktop.css) and drawn where it is stuck.
    const style = getComputedStyle(strip);
    const between = Number.parseFloat(style.columnGap) || 0;
    let left = Number.parseFloat(style.paddingLeft) || 0;
    const slots = tabs.map((tab) => {
      const width = tab.getBoundingClientRect().width;
      const slot = { left, width };
      left += width + between;
      return slot;
    });
    const pointer = { pointerId: event.pointerId, x: event.clientX, pointer: event.clientX };
    const press = { ...pointer, scrolled, view, at, tabs, slots, gap: tabGap(slots), to: at };
    begin(strip, { ...press, dragging: false, frame: undefined });
  };
}
