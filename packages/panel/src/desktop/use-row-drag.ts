/**
 * use-row-drag.ts -- a list's rows dragged up and down it to another place, or out of it into another, as the sidebar's Pinned section is ordered and the Issues board's cards are moved.
 *
 * A press on a row is a click until the pointer has gone a few pixels any
 * way; past that a copy of the row is lifted into a layer of its own over
 * the whole window and follows the pointer wherever it goes, as Linear's
 * and Notion's do, while the row itself stays in its list as its own faded
 * placeholder. Nothing the list scrolls in moves with the copy, so it is
 * never clipped by its list's column, never faded by the column's edge, and
 * never lengthens what the column scrolls, however far it is carried.
 *
 * In a list that reorders, the placeholder slides to where the row would
 * land and the rows it passes slide aside, past a row once the copy's
 * leading edge crosses that row's middle. Letting go puts it there and
 * lands the copy on it, from wherever it was let go; Escape, or
 * the system taking the pointer away, puts every row back and changes
 * nothing. A row changed under the drag puts it back as well, since the
 * places it measured have moved. Held at the top or the foot of the column
 * that scrolls the list (the sidebar's), or past it, the copy runs the
 * column along that way, faster the nearer the edge, as the tab strip runs
 * along under a tab held at its edge (`use-tab-drag.ts`), so a row reaches a
 * place, or a zone, scrolled out of sight.
 *
 * The rows are drawn on their own `transform` and the copy on its own, and
 * the stylesheet (desktop.css) times every slide from the motion tokens, so
 * reduced motion and a capture run hold them still as they hold the rest.
 * Only the drop reaches the list's owner, as one move. It is pointer events
 * with the pointer captured, never the browser's drag and drop, for the
 * reasons the strip's gives, and the captured pointer's own click lands on
 * the list rather than on the row, so a drop opens nothing.
 *
 * A list may also let its rows go elsewhere: carried over another drop zone
 * (an element wearing `data-row-drop`, a sidebar section or a board's
 * column), the placeholder stands home with its neighbours, and the zone is
 * marked as the one it would land in, with a line before the row it would
 * land above where the zone keeps an order of its own (its rows under
 * `data-row-drop-rows`). Letting go there hands the zone's id and that place
 * to the list's owner instead of a move. A list whose rows keep the view's
 * order rather than one dragged gives no move, so a row there goes only
 * elsewhere. A list that reorders and lets its rows go elsewhere reorders
 * them only while the pointer is level with its own zone; carried above or
 * below it, across the gap between two zones, it is let go nowhere unless
 * it is over another zone. A list of groups dragged by their headers names
 * the handle a press must land on, so a press on a row inside a group
 * starts that row's own drag and not the group's.
 *
 * A drop scope (an element wearing `data-row-drop-scope`: the sidebar, the
 * Issues board) keeps its zones to its own lists' rows, and its classes are
 * worn, boxless, around the copy, so its stylesheet's rules for a row still
 * draw the copy of one even though the copy stands outside it.
 */

import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";

/** How far the pointer goes any way, in CSS pixels, before a press is a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/** How near the scrolling column's top or foot, in CSS pixels, a held row runs it along: about its faded edge. */
const EDGE_REACH = 32;

/** The most the column runs along in a frame, in CSS pixels, with the pointer at its edge or past it. */
const EDGE_SPEED = 12;

/** The list's rows that move. */
const ROW = ":scope > li";

/** What a row and its list wear while a drag lasts; desktop.css fades the one to a placeholder and slides the others. */
const DRAGGING_ATTRIBUTE = "data-dragging";

/** A press on what is typed into or a control of its own, which starts no drag. */
const NOT_A_HANDLE = "input, textarea, select, [contenteditable], [data-editing]";

/** What a place a row may be dropped into wears, its id as the value. */
const DROP_ZONE = "data-row-drop";

/** What an element whose zones take only its own lists' rows wears, whose classes the copy of one of its rows is drawn under. */
const DROP_SCOPE = "data-row-drop-scope";

/** What the layer the copy of a row is carried in wears; desktop.css floats it over the window. */
const CARRIED_ATTRIBUTE = "data-carried";

/** What the copy itself wears, inside that layer; desktop.css lifts it. */
const LIFTED_ATTRIBUTE = "data-lifted";

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
  /** The layer the copy is carried in over the window once the press is a drag. */
  carried: HTMLElement | undefined;
  /** The frame the scrolling column next runs along in, while the pointer is held at its edge. */
  frame: number | undefined;
  /** The column that scrolls the list, which the copy held at its edge runs along; none where nothing does. */
  scroller: HTMLElement | undefined;
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

/** The copy's travel down the list, the pointer's own and the list's scrolling since the press, held between the first row's top and the last row's foot. */
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

/** Where the pressed row lands with the copy `moved` along: past every row whose middle the copy's leading edge has crossed. */
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

/** How far the row at `index` slides: the pressed row's placeholder to its landing, and each row it passed aside to leave it room. */
function aside(press: RowPress, index: number): number {
  const own = press.slots[press.at];
  const landing = press.slots[press.to];
  if (index === press.at) {
    if (own === undefined || landing === undefined || press.to === press.at) return 0;
    const foot = landing.top + landing.height - own.top - own.height;
    return press.to > press.at ? foot : landing.top - own.top;
  }
  const room = (own?.height ?? 0) + press.gap;
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

/**
 * The nearest element around the list, within its drop scope, that scrolls
 * it up and down: the sidebar's column. None where nothing does, as on the
 * Issues board, whose columns scroll their own cards and whose page scrolls
 * it sideways, neither of which a card carried to another column should
 * run. A column whose rows fit is never run along, having nowhere to go.
 */
function scrollerOf(list: HTMLElement, scope: Element | null): HTMLElement | undefined {
  for (let each = list.parentElement; each !== null && each !== scope; each = each.parentElement) {
    const { overflowY } = getComputedStyle(each);
    if (overflowY === "auto" || overflowY === "scroll") return each;
  }
  return undefined;
}

/**
 * How far the column runs along this frame, toward the edge the pointer is
 * held at: faster the nearer the edge, the whole of `EDGE_SPEED` at it or
 * past it, and none away from both edges or where the column has no further
 * to go that way. Each edge reaches at most half the column, so in a column
 * too short for both a pointer is near one edge only and the column never
 * turns back and forth beneath it.
 */
function edgeRun(scroller: HTMLElement, y: number): number {
  const box = scroller.getBoundingClientRect();
  const reach = Math.min(EDGE_REACH, box.height / 2);
  const above = box.top + reach - y;
  const below = y - (box.bottom - reach);
  const speed = (into: number) => Math.ceil(EDGE_SPEED * Math.min(1, into / reach));
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
 * Lifts a copy of the pressed row into a layer of its own over the window,
 * at the row's place and width on screen: in a shell of the list's tag and
 * classes, inside its scope's classes worn with no box of their own, so the
 * rules that draw the row draw the copy, and in the list's own type and
 * colour, which it inherits there. The shell keeps none of a column's
 * scrolling, inset, or faded edge. The layer is hidden from assistive
 * technology, since the row it copies is still there.
 */
function liftCopy(row: HTMLElement, list: HTMLElement, scope: Element | null): HTMLElement {
  const copy = row.cloneNode(true);
  if (copy instanceof HTMLElement) {
    copy.setAttribute(LIFTED_ATTRIBUTE, "true");
    copy.style.transform = "";
  }
  const shell = document.createElement(list.tagName);
  shell.className = list.className;
  Object.assign(shell.style, {
    margin: "0",
    padding: "0",
    overflow: "visible",
    maskImage: "none",
    animation: "none",
  });
  shell.append(copy);
  const layer = document.createElement("div");
  layer.setAttribute(CARRIED_ATTRIBUTE, "true");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("inert", "");
  const box = row.getBoundingClientRect();
  const look = getComputedStyle(list);
  Object.assign(layer.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    color: look.color,
    fontFamily: look.fontFamily,
    fontSize: look.fontSize,
    lineHeight: look.lineHeight,
    letterSpacing: look.letterSpacing,
  });
  if (scope === null) layer.append(shell);
  else {
    const ground = document.createElement("div");
    ground.className = scope.className;
    ground.style.display = "contents";
    ground.append(shell);
    layer.append(ground);
  }
  document.body.append(layer);
  return layer;
}

/**
 * Whether the pointer is level with the list's own zone, or with the list
 * where it stands in none, however far it strays sideways: where a list
 * that also lets its rows go elsewhere reorders them.
 */
function levelWithHome(press: RowPress, list: HTMLElement): boolean {
  const home = list.closest(`[${DROP_ZONE}]`) ?? list;
  const box = home.getBoundingClientRect();
  return box.top <= press.pointer && press.pointer < box.bottom;
}

/**
 * Draws the drag where the pointer has it: the copy follows the pointer, and
 * in a list that reorders, its placeholder slides to where it would land and
 * those it passed stand aside; carried over another zone, or out of a list
 * that keeps no order of its own, every row stands home.
 */
function draw(press: RowPress, list: HTMLElement, out: boolean): void {
  const zone = out ? zoneUnder(press, list) : undefined;
  mark(press, zone);
  if (press.carried !== undefined) {
    const across = press.pointerX - press.x;
    const down = press.pointer - press.y;
    press.carried.style.transform = `translate(${across}px, ${down}px)`;
  }
  const reordering = press.reorders && zone === undefined && (!out || levelWithHome(press, list));
  press.to = reordering ? landing(press, travel(press, list)) : press.at;
  press.rows.forEach((row, index) => {
    const shift = aside(press, index);
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
  press.carried?.remove();
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

/** A motion token's length, in milliseconds: none for a token unset or held still. */
function lengthOf(token: string): number {
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value)) return 0;
  return token.trim().endsWith("ms") ? value : value * 1000;
}

/**
 * Lands the copy: plays it from where it was let go, on both axes, into the
 * place the row now stands, on the rows' own timing, then takes it down,
 * the row standing faded beneath it until it does, so the two never show
 * at once. The timing is read at the list, so reduced motion and a capture
 * run, which hold the tokens there, land it at once.
 */
function land(copy: HTMLElement, row: HTMLElement, list: HTMLElement): void {
  const look = getComputedStyle(list);
  const duration = lengthOf(look.getPropertyValue("--duration-fast"));
  if (duration <= 0) {
    copy.remove();
    return;
  }
  const home = row.getBoundingClientRect();
  const across = home.left - Number.parseFloat(copy.style.left);
  const down = home.top - Number.parseFloat(copy.style.top);
  row.setAttribute(DRAGGING_ATTRIBUTE, "true");
  const easing = look.getPropertyValue("--spring-fast").trim() || "ease-out";
  const landed = copy.animate(
    [{ transform: copy.style.transform }, { transform: `translate(${across}px, ${down}px)` }],
    { duration, easing, fill: "forwards" },
  );
  landed.onfinish = () => {
    copy.remove();
    row.removeAttribute(DRAGGING_ATTRIBUTE);
  };
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
  const abandon = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = onMove;
    latestOut.current = options.onDropOut;
  });
  // A list taken away under a drag takes its copy down with it.
  useEffect(() => () => abandon.current?.(), []);
  const { handle } = options;
  const out = options.onDropOut !== undefined;
  if (onMove === undefined && !out) return undefined;

  const begin = (list: HTMLElement, press: RowPress) => {
    const pressed = () => press.rows[press.at];
    const { scroller } = press;
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
      const across = Math.abs(event.clientX - press.x);
      const far = Math.max(across, Math.abs(event.clientY - press.y)) >= DRAG_THRESHOLD;
      if (!press.dragging && !far) return;
      if (!press.dragging) {
        press.dragging = true;
        list.setPointerCapture(press.pointerId);
        list.setAttribute(DRAGGING_ATTRIBUTE, "true");
        const row = pressed();
        // Copied before it is marked, so the copy is lifted rather than faded.
        if (row !== undefined) press.carried = liftCopy(row, list, press.scope);
        row?.setAttribute(DRAGGING_ATTRIBUTE, "true");
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
      // The list is drawn in its new order before the rows come down, so they
      // come down where that drew them, and the copy lands on the row there.
      flushSync(() => {
        if (press.to !== press.at) latest.current?.(press.at, press.to);
      });
      const copy = press.carried;
      press.carried = undefined;
      lower(press, list, false);
      if (copy !== undefined) land(copy, row, list);
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
    abandon.current = putBack;
    release.current = () => {
      abandon.current = undefined;
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
    const state = {
      to: at,
      dragging: false,
      reorders: onMove !== undefined,
      zone: undefined,
      scope,
      carried: undefined,
      frame: undefined,
      scroller: scrollerOf(list, scope),
    };
    begin(list, { ...pointer, listTop, at, rows, slots, gap, ...state });
  };
}
