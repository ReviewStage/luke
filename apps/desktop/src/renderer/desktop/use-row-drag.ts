/**
 * use-row-drag.ts -- a list's rows dragged up and down it to another place, as the sidebar's Pinned section is ordered.
 *
 * The tab strip's drag (`use-tab-drag.ts`) turned on its side: a press on a
 * row is a click until the pointer has gone a few pixels up or down; past
 * that the row is lifted and follows the pointer, held within the list, and
 * the rows it passes slide aside to show where it will land, past a row
 * once its leading edge crosses that row's middle. Letting go puts it there;
 * Escape, or the system taking the pointer away, puts every row back and
 * changes nothing. A row changed under the drag puts it back as well, since
 * the places it measured have moved.
 *
 * The drag is drawn on the rows' own `transform` and nothing else, and the
 * stylesheet (desktop.css) times every slide from the motion tokens, so
 * reduced motion and a capture run hold it still as they hold the rest.
 * Only the drop reaches the list's owner, as one move. It is pointer events
 * with the pointer captured, never the browser's drag and drop, for the
 * reasons the strip's gives, and the captured pointer's own click lands on
 * the list rather than on the row, so a drop opens nothing.
 */

import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";

/** How far the pointer goes up or down, in CSS pixels, before a press is a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/** The list's rows that move. */
const ROW = ":scope > li";

/** What a row and its list wear while a drag lasts; desktop.css lifts the one and slides the others. */
const DRAGGING_ATTRIBUTE = "data-dragging";

/** A press on what is typed into or a control of its own, which starts no drag. */
const NOT_A_HANDLE = "input, textarea, select, [contenteditable], [data-editing]";

/** A row's stretch down the list as laid out when the press began. */
interface Slot {
  top: number;
  height: number;
}

/**
 * A press on a row, and the drag it became once it went far enough: the
 * pointer, where it began and where it is now, where the list's top stood
 * on screen then, so a scroll of the sidebar beneath a held row moves none
 * of the places measured, the rows and their slots, the space between two of
 * them, and where the pressed row would land now.
 */
interface RowPress {
  pointerId: number;
  y: number;
  pointer: number;
  listTop: number;
  at: number;
  rows: HTMLElement[];
  slots: Slot[];
  gap: number;
  to: number;
  dragging: boolean;
}

/** What the list's owner hears from a drop: the row at `from` now stands at `to`, which differs from it. */
export type RowMove = (from: number, to: number) => void;

/** The pressed row's travel, the pointer's own and the list's scrolling since the press, held between the first row's top and the last row's foot. */
function travel(press: RowPress, list: HTMLElement): number {
  const own = press.slots[press.at];
  const first = press.slots[0];
  const last = press.slots.at(-1);
  if (own === undefined || first === undefined || last === undefined) return 0;
  const least = first.top - own.top;
  const most = last.top + last.height - own.top - own.height;
  const scrolled = press.listTop - list.getBoundingClientRect().top;
  return Math.max(least, Math.min(most, press.pointer - press.y + scrolled));
}

/** Where the pressed row lands, `moved` along: past every row whose middle its leading edge has crossed. */
function landing(press: RowPress, moved: number): number {
  const own = press.slots[press.at];
  if (own === undefined) return press.at;
  const top = own.top + moved;
  const foot = top + own.height;
  return press.slots.filter((slot, index) => {
    const crossing = slot.top + slot.height / 2;
    return index < press.at ? top > crossing : index > press.at && foot >= crossing;
  }).length;
}

/** How far the row at `index` slides aside to leave the pressed row its landing. */
function aside(press: RowPress, index: number): number {
  const room = (press.slots[press.at]?.height ?? 0) + press.gap;
  if (index > press.at && index <= press.to) return -room;
  if (index < press.at && index >= press.to) return room;
  return 0;
}

/** Draws the drag where the pointer has it: the pressed row follows, and those it passed stand aside. */
function draw(press: RowPress, list: HTMLElement): void {
  const moved = travel(press, list);
  press.to = landing(press, moved);
  press.rows.forEach((row, index) => {
    const shift = index === press.at ? moved : aside(press, index);
    row.style.transform = shift === 0 ? "" : `translateY(${shift}px)`;
  });
}

/**
 * Takes the drag down: a put-back lets every row slide home on the
 * stylesheet's timing, while a drop clears them at once, because the list
 * has already been drawn in its new order beneath them.
 */
function lower(press: RowPress, list: HTMLElement, settle: boolean): void {
  for (const row of press.rows) {
    row.removeAttribute(DRAGGING_ATTRIBUTE);
    if (!settle) row.style.transition = "none";
    row.style.transform = "";
  }
  list.removeAttribute(DRAGGING_ATTRIBUTE);
  if (settle) return;
  // Laid out with no transition, so letting the transition back plays nothing.
  list.getBoundingClientRect();
  for (const row of press.rows) row.style.transition = "";
}

/** Plays the dropped row from where it was let go, `top`, into the place the new order gave it. */
function settleDropped(row: HTMLElement, top: number): void {
  const shift = top - row.getBoundingClientRect().top;
  if (shift === 0) return;
  row.style.transition = "none";
  row.style.transform = `translateY(${shift}px)`;
  row.getBoundingClientRect();
  row.style.transition = "";
  row.style.transform = "";
}

/**
 * The list's drag: spread `onPointerDown` on the list. A press is heard at
 * the window from then on, so it outlives the pointer leaving the list, and
 * the pointer is captured only once the press is a drag, so a press that
 * stays a click lands on the row as any click does. None where nothing
 * hears a move, or where the list's rows find the drop elsewhere.
 */
export function useRowDrag(
  onMove: RowMove | undefined,
): React.PointerEventHandler<HTMLElement> | undefined {
  const latest = useRef(onMove);
  const release = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = onMove;
  });
  useEffect(() => () => release.current?.(), []);
  if (onMove === undefined) return undefined;

  const begin = (list: HTMLElement, press: RowPress) => {
    const pressed = () => press.rows[press.at];
    const move = (event: PointerEvent) => {
      if (event.pointerId !== press.pointerId) return;
      if (!press.dragging && Math.abs(event.clientY - press.y) < DRAG_THRESHOLD) return;
      if (!press.dragging) {
        press.dragging = true;
        list.setPointerCapture(press.pointerId);
        list.setAttribute(DRAGGING_ATTRIBUTE, "true");
        pressed()?.setAttribute(DRAGGING_ATTRIBUTE, "true");
      }
      press.pointer = event.clientY;
      draw(press, list);
    };
    const putBack = () => {
      release.current?.();
      if (press.dragging) lower(press, list, true);
    };
    const drop = (event: PointerEvent) => {
      if (event.pointerId !== press.pointerId) return;
      release.current?.();
      const row = pressed();
      if (!press.dragging || row === undefined) return;
      // A row pinned or unpinned under the drag leaves its places stale, so
      // the drag is put back rather than dropped at a place that moved.
      const now = [...list.querySelectorAll<HTMLElement>(ROW)];
      if (now.length !== press.rows.length || now.some((each, at) => each !== press.rows[at])) {
        lower(press, list, true);
        return;
      }
      const top = row.getBoundingClientRect().top;
      // The list is drawn in its new order before the rows come down, so they come down where that drew them.
      flushSync(() => {
        if (press.to !== press.at) latest.current?.(press.at, press.to);
      });
      lower(press, list, false);
      settleDropped(row, top);
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === press.pointerId) putBack();
    };
    // The sidebar run along under a pointer held still, by a wheel or a
    // trackpad, moves where the row would land.
    const runBeneath = () => {
      if (press.dragging) draw(press, list);
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
    window.addEventListener("scroll", runBeneath, true);
    release.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", drop, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("scroll", runBeneath, true);
      release.current = undefined;
    };
  };

  return (event) => {
    const list = event.currentTarget;
    const target = event.target instanceof Element ? event.target : null;
    if (event.button !== 0 || release.current !== undefined || target === null) return;
    if (target.closest(NOT_A_HANDLE) !== null) return;
    const rows = [...list.querySelectorAll<HTMLElement>(ROW)];
    const at = rows.findIndex((row) => row.contains(target));
    if (at < 0 || rows.length < 2) return;
    const slots = rows.map((row) => {
      const box = row.getBoundingClientRect();
      return { top: box.top, height: box.height };
    });
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    const pointer = { pointerId: event.pointerId, y: event.clientY, pointer: event.clientY };
    const listTop = list.getBoundingClientRect().top;
    begin(list, { ...pointer, listTop, at, rows, slots, gap, to: at, dragging: false });
  };
}
