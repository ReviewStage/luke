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
 * the places it measured have moved. Held at the top or the foot of the
 * column that scrolls the list (the sidebar's), or past it, the row runs
 * the column along that way, faster the nearer the edge, as the tab strip
 * runs along under a tab held at its edge, so a row reaches a place, or a
 * zone, scrolled out of sight.
 *
 * The drag is drawn on the rows' own `transform` and nothing else, and the
 * stylesheet (desktop.css) times every slide from the motion tokens, so
 * reduced motion and a capture run hold it still as they hold the rest.
 * Only the drop reaches the list's owner, as one move. It is pointer events
 * with the pointer captured, never the browser's drag and drop, for the
 * reasons the strip's gives, and the captured pointer's own click lands on
 * the list rather than on the row, so a drop opens nothing.
 *
 * A list may also let its rows go elsewhere: carried over another drop zone
 * (an element wearing `data-row-drop`, a sidebar section), the row follows
 * the pointer out of its own list, its neighbours stand back home, and the
 * zone is marked as the one it would land in, with a line before the row
 * it would land above where the zone keeps an order of its own (its rows
 * under `data-row-drop-rows`). Letting go there hands the zone's id and that
 * place to the list's owner instead of a move. A list whose rows keep the
 * view's order rather than one dragged gives no move, so a row there goes
 * only elsewhere, and follows the pointer wherever it is carried, its own
 * zone's header included, rather than being held within its list. A row of
 * a list that reorders is held within its list only while the pointer is
 * level with its own zone; carried above or below it, across the gap
 * between two zones, it follows the pointer too, and is let go nowhere
 * unless it is over another zone. A list of groups dragged by their headers
 * names the handle a press must land on, so a press on a row inside a group
 * starts that row's own drag and not the group's.
 *
 * A drop scope (an element wearing `data-row-drop-scope`, the Issues board)
 * keeps its zones to its own lists' rows, and a row of one of its lists
 * goes any way, so it is a drag once the pointer has gone a few pixels in
 * any direction. Such a list scrolls its own rows and would clip one
 * carried out of it, so the row is not moved: it stays as its own
 * placeholder while a copy of it, lifted over the scope, follows the
 * pointer on its `transform`. A row of a scope is carried rather than
 * reordered.
 */

import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";

/** How far the pointer goes up or down, or any way in a drop scope, in CSS pixels, before a press is a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/** How near the scrolling column's top or foot, in CSS pixels, a held row runs it along: about its faded edge. */
const EDGE_REACH = 32;

/** The most the column runs along in a frame, in CSS pixels, with the pointer at its edge or past it. */
const EDGE_SPEED = 12;

/** The list's rows that move. */
const ROW = ":scope > li";

/** What a row and its list wear while a drag lasts; desktop.css lifts the one and slides the others. */
const DRAGGING_ATTRIBUTE = "data-dragging";

/** A press on what is typed into or a control of its own, which starts no drag. */
const NOT_A_HANDLE = "input, textarea, select, [contenteditable], [data-editing]";

/** What a place a row may be dropped into wears, its id as the value. */
const DROP_ZONE = "data-row-drop";

/** What an element whose zones take only its own lists' rows wears, over which a row of its lists is carried as a copy. */
const DROP_SCOPE = "data-row-drop-scope";

/** What the copy of a row carried over its scope wears; the scope's stylesheet lifts it there. */
const CARRIED_ATTRIBUTE = "data-carried";

/** A drop zone's rows, where it keeps an order of its own that a drop lands at a place in. */
const ZONE_ROWS = "[data-row-drop-rows] > li";

/** What the zone a row is carried over wears while it is. */
const DROP_TARGET = "data-drop-target";

/** What the row a drop would land above wears, and the last row where it would land below them all. */
const DROP_BEFORE = "data-drop-before";
const DROP_AFTER = "data-drop-after";

/** A zone the pressed row is carried over: the element, its id, and the place among its rows it would land at. */
interface ZoneLanding {
  zone: HTMLElement;
  id: string;
  at: number;
}

/** The copy of a row carried over its scope, in a shell of its list's own kind, and where the scope stood on screen as it was lifted. */
interface Carried {
  shell: HTMLElement;
  left: number;
  top: number;
}

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
  x: number;
  y: number;
  pointer: number;
  pointerX: number;
  listTop: number;
  at: number;
  rows: HTMLElement[];
  slots: Slot[];
  gap: number;
  to: number;
  dragging: boolean;
  /** Whether the rows reorder among themselves, which a list in the view's own order does not. */
  reorders: boolean;
  /** The zone it would land in out of its own list, if it is over one. */
  zone: ZoneLanding | undefined;
  /** The drop scope the list stands in, whose zones alone it drops into; none for the window's own. */
  scope: Element | null;
  /** The copy carried over the scope once the press is a drag. */
  carried: Carried | undefined;
  /** The frame the scrolling column next runs along in, while the pointer is held at its edge. */
  frame: number | undefined;
}

/** What a list's rows may do beyond moving among themselves. */
export interface RowDragOptions {
  /** Hears a row let go over another drop zone: the row at `from` here, the zone's id, and the place among the zone's rows it lands at. */
  onDropOut?: ((from: number, zone: string, at: number) => void) | undefined;
  /** What a press must land in to start a drag, where a row is a group with rows of its own inside. */
  handle?: string;
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

/** Where among a zone's ordered rows a pointer at `y` would land a row: below every row whose middle it is past. */
function landingIn(zone: HTMLElement, y: number): number {
  return [...zone.querySelectorAll<HTMLElement>(ZONE_ROWS)].filter((row) => {
    const box = row.getBoundingClientRect();
    return box.top + box.height / 2 < y;
  }).length;
}

/** The drop zone of the list's scope under the pointer other than the list's own, with where it would land; none over the list's own or over nothing. */
function zoneUnder(press: RowPress, list: HTMLElement): ZoneLanding | undefined {
  const own = list.closest(`[${DROP_ZONE}]`);
  const zone = [...document.querySelectorAll<HTMLElement>(`[${DROP_ZONE}]`)].find((each) => {
    if (each.closest(`[${DROP_SCOPE}]`) !== press.scope) return false;
    const box = each.getBoundingClientRect();
    const { pointer: y, pointerX: x } = press;
    return box.top <= y && y < box.bottom && box.left <= x && x <= box.right;
  });
  const id = zone?.getAttribute(DROP_ZONE);
  if (zone === undefined || zone === own || id === null || id === undefined) return undefined;
  return { zone, id, at: landingIn(zone, press.pointer) };
}

/** The nearest element around the list that scrolls it up and down, the sidebar's column, as the press begins; none where nothing does. */
function scrollerOf(list: HTMLElement): HTMLElement | undefined {
  for (let each = list.parentElement; each !== null; each = each.parentElement) {
    const { overflowY } = getComputedStyle(each);
    const scrolls = overflowY === "auto" || overflowY === "scroll";
    if (scrolls && each.scrollHeight > each.clientHeight) return each;
  }
  return undefined;
}

/**
 * How far the column runs along this frame, toward the edge the pointer is
 * held at: faster the nearer the edge, the whole of `EDGE_SPEED` at it or
 * past it, and none away from both edges or where the column has no further
 * to go that way.
 */
function edgeRun(scroller: HTMLElement, y: number): number {
  const box = scroller.getBoundingClientRect();
  const above = box.top + EDGE_REACH - y;
  const below = y - (box.bottom - EDGE_REACH);
  const speed = (into: number) => Math.ceil(EDGE_SPEED * Math.min(1, into / EDGE_REACH));
  if (above > 0 && scroller.scrollTop > 0) return -speed(above);
  const end = scroller.scrollHeight - scroller.clientHeight;
  if (below > 0 && scroller.scrollTop < end) return speed(below);
  return 0;
}

/** Takes down the marks of the zone the row was carried over. */
function unmark(press: RowPress): void {
  const zone = press.zone?.zone;
  press.zone = undefined;
  if (zone === undefined) return;
  zone.removeAttribute(DROP_TARGET);
  for (const row of zone.querySelectorAll(`[${DROP_BEFORE}], [${DROP_AFTER}]`)) {
    row.removeAttribute(DROP_BEFORE);
    row.removeAttribute(DROP_AFTER);
  }
}

/** Marks the zone the row is carried over, and the line it would land at where the zone keeps an order. */
function mark(press: RowPress, landing: ZoneLanding | undefined): void {
  unmark(press);
  press.zone = landing;
  if (landing === undefined) return;
  landing.zone.setAttribute(DROP_TARGET, "true");
  const rows = [...landing.zone.querySelectorAll<HTMLElement>(ZONE_ROWS)];
  const before = rows[landing.at];
  if (before !== undefined) before.setAttribute(DROP_BEFORE, "true");
  else rows.at(-1)?.setAttribute(DROP_AFTER, "true");
}

/**
 * Lifts a copy of the pressed row over its scope, at the row's own place:
 * in a shell of the list's tag and classes, so the row's own rules still
 * draw it, and hidden from assistive technology, since the row it copies
 * is still there.
 */
function liftCopy(row: HTMLElement, list: HTMLElement, scope: Element): Carried {
  const shell = document.createElement(list.tagName);
  shell.className = list.className;
  shell.setAttribute(CARRIED_ATTRIBUTE, "true");
  shell.setAttribute("aria-hidden", "true");
  shell.append(row.cloneNode(true));
  const box = row.getBoundingClientRect();
  const ground = scope.getBoundingClientRect();
  shell.style.left = `${box.left - ground.left + scope.scrollLeft}px`;
  shell.style.top = `${box.top - ground.top + scope.scrollTop}px`;
  shell.style.width = `${box.width}px`;
  scope.append(shell);
  return { shell, left: ground.left, top: ground.top };
}

/** Draws the carried copy where the pointer has it, however far the scope has scrolled beneath it since it was lifted. */
function drawCarried(press: RowPress, carried: Carried, scope: Element): void {
  const ground = scope.getBoundingClientRect();
  const across = press.pointerX - press.x - (ground.left - carried.left);
  const down = press.pointer - press.y - (ground.top - carried.top);
  carried.shell.style.transform = `translate(${across}px, ${down}px)`;
}

/** Draws the row carried out of its list: it follows the pointer, and the rows it left stand home. */
function drawOut(press: RowPress, list: HTMLElement): void {
  const scrolled = press.listTop - list.getBoundingClientRect().top;
  const moved = press.pointer - press.y + scrolled;
  press.to = press.at;
  press.rows.forEach((row, index) => {
    row.style.transform = index === press.at ? `translateY(${moved}px)` : "";
  });
}

/**
 * Whether the pressed row is reordered among its list's rows where the
 * pointer is now: only in a list that reorders, and only while the pointer
 * is level with the list's own zone, or with the list where it stands in
 * none, however far it strays sideways.
 */
function heldHome(press: RowPress, list: HTMLElement): boolean {
  if (!press.reorders) return false;
  const home = list.closest(`[${DROP_ZONE}]`) ?? list;
  const box = home.getBoundingClientRect();
  return box.top <= press.pointer && press.pointer < box.bottom;
}

/** Draws the drag where the pointer has it: the pressed row follows, and those it passed stand aside, or it is carried over another zone. */
function draw(press: RowPress, list: HTMLElement, out: boolean): void {
  const zone = out ? zoneUnder(press, list) : undefined;
  mark(press, zone);
  if (press.carried !== undefined && press.scope !== null) {
    press.to = press.at;
    drawCarried(press, press.carried, press.scope);
    return;
  }
  if (zone !== undefined || (out && !heldHome(press, list))) {
    drawOut(press, list);
    return;
  }
  const moved = travel(press, list);
  press.to = press.reorders ? landing(press, moved) : press.at;
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
  unmark(press);
  press.carried?.shell.remove();
  press.carried = undefined;
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
 * hears a move or a drop elsewhere, or where the list's rows find the drop
 * elsewhere.
 */
export function useRowDrag(
  onMove: RowMove | undefined,
  options: RowDragOptions = {},
): React.PointerEventHandler<HTMLElement> | undefined {
  const latest = useRef(onMove);
  const latestOut = useRef(options.onDropOut);
  const release = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = onMove;
    latestOut.current = options.onDropOut;
  });
  useEffect(() => () => release.current?.(), []);
  const { handle } = options;
  const out = options.onDropOut !== undefined;
  if (onMove === undefined && !out) return undefined;

  const begin = (list: HTMLElement, press: RowPress) => {
    const pressed = () => press.rows[press.at];
    // A scope's rows are carried over it as a copy, so only a list that
    // moves its own rows runs the column it stands in.
    const scroller = press.scope === null ? scrollerOf(list) : undefined;
    // Note that the column is run along at once rather than gliding, because
    // a glide would be restarted, and cut short, by every frame.
    const runAlong = () => {
      press.frame = undefined;
      if (!press.dragging || scroller === undefined) return;
      const from = scroller.scrollTop;
      const by = edgeRun(scroller, press.pointer);
      if (by === 0) return;
      scroller.style.scrollBehavior = "auto";
      scroller.scrollTop = from + by;
      scroller.style.scrollBehavior = "";
      // A column already at its end stops running however the pointer is held.
      if (scroller.scrollTop === from) return;
      draw(press, list, out);
      press.frame = requestAnimationFrame(runAlong);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== press.pointerId) return;
      const across = press.scope === null ? 0 : Math.abs(event.clientX - press.x);
      const far = Math.max(across, Math.abs(event.clientY - press.y)) >= DRAG_THRESHOLD;
      if (!press.dragging && !far) return;
      if (!press.dragging) {
        press.dragging = true;
        list.setPointerCapture(press.pointerId);
        list.setAttribute(DRAGGING_ATTRIBUTE, "true");
        const row = pressed();
        row?.setAttribute(DRAGGING_ATTRIBUTE, "true");
        if (row !== undefined && press.scope !== null) {
          press.carried = liftCopy(row, list, press.scope);
        }
      }
      press.pointer = event.clientY;
      press.pointerX = event.clientX;
      draw(press, list, out);
      if (press.frame === undefined && scroller !== undefined) {
        press.frame = requestAnimationFrame(runAlong);
      }
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
      // The drag is drawn where the pointer was let go, which a move may not have reported.
      press.pointer = event.clientY;
      press.pointerX = event.clientX;
      draw(press, list, out);
      const zone = press.zone;
      if (zone !== undefined) {
        // The row now stands in the zone's list, so it comes down there rather than settling here.
        flushSync(() => latestOut.current?.(press.at, zone.id, zone.at));
        lower(press, list, false);
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
      if (press.dragging) draw(press, list, out);
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
      if (press.frame !== undefined) cancelAnimationFrame(press.frame);
      press.frame = undefined;
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
    // A row alone in its list has nowhere to move but out of it.
    if (at < 0 || (rows.length < 2 && !out)) return;
    const grip = handle === undefined ? null : target.closest(handle);
    if (handle !== undefined && (grip === null || !rows[at]?.contains(grip))) return;
    const slots = rows.map((row) => {
      const box = row.getBoundingClientRect();
      return { top: box.top, height: box.height };
    });
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    const pointer = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pointer: event.clientY,
      pointerX: event.clientX,
    };
    const listTop = list.getBoundingClientRect().top;
    const scope = list.closest(`[${DROP_SCOPE}]`);
    const reorders = onMove !== undefined && scope === null;
    const state = {
      to: at,
      dragging: false,
      reorders,
      zone: undefined,
      scope,
      carried: undefined,
      frame: undefined,
    };
    begin(list, { ...pointer, listTop, at, rows, slots, gap, ...state });
  };
}
