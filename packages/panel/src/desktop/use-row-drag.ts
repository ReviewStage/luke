import { CARD_DROP_TARGET, MOTION_TOKEN, tokenTiming } from "@repo/ui";
import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";

const DRAG_THRESHOLD = 4;

const EDGE_REACH = 32;

const EDGE_SPEED = 12;

const TASK_ID = "data-task-id";

const ROW_INDEX = "data-index";

const TAKES_FOCUS = "button, a[href], [tabindex]";

const DRAGGING_ATTRIBUTE = "data-dragging";

const NOT_A_HANDLE = "input, textarea, select, [contenteditable], [data-editing]";

const DROP_ZONE = "data-row-drop";

const DROP_SCOPE = "data-row-drop-scope";

const CARRIED_ATTRIBUTE = "data-carried";

const LIFTED_ATTRIBUTE = "data-lifted";

const DROP_TARGET = CARD_DROP_TARGET;

const DROP_BEFORE = "data-drop-before";
const DROP_AFTER = "data-drop-after";

interface RowKind<Row> {
  readonly item: string;
  readonly name: (row: HTMLElement, at: number) => Row | undefined;
  readonly partial: boolean;
}

const PLACED_ROW: RowKind<number> = { item: "li", name: (_row, at) => at, partial: false };

const RUN_ROW: RowKind<number> = {
  item: "li",
  name: (row) => {
    const at = Number(row.getAttribute(ROW_INDEX));
    return Number.isInteger(at) ? at : undefined;
  },
  partial: true,
};

const TASK_ROW: RowKind<string> = {
  item: `li[${TASK_ID}]`,
  name: (row) => row.getAttribute(TASK_ID) ?? undefined,
  partial: true,
};

interface ZoneLanding {
  zone: HTMLElement;
  id: string;
  at: number;
}

interface Slot {
  top: number;
  height: number;
}

interface RowPress {
  pointerId: number;
  x: number;
  y: number;
  pointer: number;
  pointerX: number;
  listTop: number;
  item: string;
  partial: boolean;
  control: HTMLElement | undefined;
  at: number;
  rows: HTMLElement[];
  slots: Slot[];
  gap: number;
  to: number;
  dragging: boolean;
  reorders: boolean;
  zone: ZoneLanding | undefined;
  scope: Element | null;
  carried: HTMLElement | undefined;
  frame: number | undefined;
  scroller: HTMLElement | undefined;
}

export interface RowDragOptions<Row = number> {
  onDropOut?: ((from: Row, zone: string, at: number) => void) | undefined;
  handle?: string;
  onCarried?: ((carried: boolean) => void) | undefined;
}

export type RowMove<Row = number> = (from: Row, to: number) => void;

function rowsIn(list: HTMLElement, item: string): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(`:scope > ${item}:not([data-leaving])`)];
}

function placeAmong(press: RowPress, rows: readonly HTMLElement[], at: number): number {
  if (!press.partial) return at;
  const before = rows[at];
  if (before !== undefined) return Number(before.getAttribute(ROW_INDEX)) || 0;
  const last = rows.at(-1);
  return last === undefined ? 0 : (Number(last.getAttribute(ROW_INDEX)) || 0) + 1;
}

function zoneRowsIn(zone: HTMLElement, item: string): HTMLElement[] {
  return [
    ...zone.querySelectorAll<HTMLElement>(`[data-row-drop-rows] > ${item}:not([data-leaving])`),
  ];
}

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

function landingIn(zone: HTMLElement, item: string, y: number): number {
  return zoneRowsIn(zone, item).filter((row) => {
    const box = row.getBoundingClientRect();
    return box.top + box.height / 2 < y;
  }).length;
}

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
  return { zone, id, at: landingIn(zone, press.item, press.pointer) };
}

function scrollerOf(list: HTMLElement, scope: Element | null): HTMLElement | undefined {
  const home = list.closest(`[${DROP_ZONE}]`) ?? list;
  for (let each = home.parentElement; each !== null && each !== scope; each = each.parentElement) {
    const { overflowY } = getComputedStyle(each);
    if (overflowY === "auto" || overflowY === "scroll") return each;
  }
  return undefined;
}

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

function mark(press: RowPress, landing: ZoneLanding | undefined): void {
  unmark(press);
  press.zone = landing;
  if (landing === undefined) return;
  landing.zone.setAttribute(DROP_TARGET, "true");
  const rows = zoneRowsIn(landing.zone, press.item);
  const before = rows[landing.at];
  if (before !== undefined) before.setAttribute(DROP_BEFORE, "true");
  else rows.at(-1)?.setAttribute(DROP_AFTER, "true");
}

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

function levelWithHome(press: RowPress, list: HTMLElement): boolean {
  const home = list.closest(`[${DROP_ZONE}]`) ?? list;
  const box = home.getBoundingClientRect();
  return box.top <= press.pointer && press.pointer < box.bottom;
}

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
  list.getBoundingClientRect();
  for (const row of press.rows) row.style.transition = "";
}

function land(copy: HTMLElement, row: HTMLElement, list: HTMLElement): void {
  const timing = tokenTiming(list, MOTION_TOKEN.DURATION_FAST, MOTION_TOKEN.SPRING_FAST);
  if (timing === undefined) {
    copy.remove();
    return;
  }
  const home = row.getBoundingClientRect();
  const across = home.left - Number.parseFloat(copy.style.left);
  const down = home.top - Number.parseFloat(copy.style.top);
  row.setAttribute(DRAGGING_ATTRIBUTE, "true");
  const landed = copy.animate(
    [{ transform: copy.style.transform }, { transform: `translate(${across}px, ${down}px)` }],
    { ...timing, fill: "forwards" },
  );
  landed.onfinish = () => {
    copy.remove();
    row.removeAttribute(DRAGGING_ATTRIBUTE);
  };
}

function useListDrag<Row>(
  kind: RowKind<Row>,
  onMove: RowMove<Row> | undefined,
  options: RowDragOptions<Row>,
): React.PointerEventHandler<HTMLElement> | undefined {
  const latest = useRef(onMove);
  const latestOut = useRef(options.onDropOut);
  const latestCarried = useRef(options.onCarried);
  const release = useRef<(() => void) | undefined>(undefined);
  const abandon = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = onMove;
    latestOut.current = options.onDropOut;
    latestCarried.current = options.onCarried;
  });
  useEffect(() => () => abandon.current?.(), []);
  const { handle } = options;
  const out = options.onDropOut !== undefined;
  if (onMove === undefined && !out) return undefined;

  const begin = (list: HTMLElement, press: RowPress, name: Row) => {
    const pressed = () => press.rows[press.at];
    const carried = (now: boolean) => latestCarried.current?.(now);
    const { scroller } = press;
    const runAlong = () => {
      press.frame = undefined;
      if (!press.dragging || scroller === undefined) return;
      const from = scroller.scrollTop;
      const by = edgeRun(scroller, press.pointer);
      if (by === 0) return;
      scroller.style.scrollBehavior = "auto";
      scroller.scrollTop = from + by;
      scroller.style.scrollBehavior = "";
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
        if (row !== undefined) press.carried = liftCopy(row, list, press.scope);
        row?.setAttribute(DRAGGING_ATTRIBUTE, "true");
        if (press.partial) press.control?.focus({ preventScroll: true });
        flushSync(() => carried(true));
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
      if (!press.dragging) return;
      lower(press, list, true);
      carried(false);
    };
    const drop = (event: PointerEvent) => {
      if (event.pointerId !== press.pointerId) return;
      release.current?.();
      const row = pressed();
      if (!press.dragging || row === undefined) return;
      const now = rowsIn(list, press.item);
      const stale = press.partial
        ? !now.includes(row)
        : now.length !== press.rows.length || now.some((each, at) => each !== press.rows[at]);
      if (stale) {
        lower(press, list, true);
        carried(false);
        return;
      }
      press.pointer = event.clientY;
      press.pointerX = event.clientX;
      draw(press, list, out);
      const zone = press.zone;
      if (zone !== undefined) {
        const at = placeAmong(press, zoneRowsIn(zone.zone, press.item), zone.at);
        flushSync(() => {
          latestOut.current?.(name, zone.id, at);
          carried(false);
        });
        lower(press, list, false);
        return;
      }
      flushSync(() => {
        if (press.to !== press.at) latest.current?.(name, placeAmong(press, press.rows, press.to));
        carried(false);
      });
      const copy = press.carried;
      press.carried = undefined;
      lower(press, list, false);
      if (copy !== undefined) land(copy, row, list);
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === press.pointerId) putBack();
    };
    const runBeneath = () => {
      if (press.dragging) draw(press, list, out);
    };
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
    const rows = rowsIn(list, kind.item);
    const at = rows.findIndex((row) => row.contains(target));
    const pressed = rows[at];
    const name = pressed === undefined ? undefined : kind.name(pressed, at);
    if (name === undefined || (rows.length < 2 && !out)) return;
    const grip = handle === undefined ? null : target.closest(handle);
    if (handle !== undefined && (grip === null || !pressed?.contains(grip))) return;
    const control = target.closest<HTMLElement>(TAKES_FOCUS) ?? undefined;
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
    const kept = {
      item: kind.item,
      partial: kind.partial,
      control: control !== undefined && pressed?.contains(control) === true ? control : undefined,
    };
    begin(list, { ...pointer, listTop, ...kept, at, rows, slots, gap, ...state }, name);
  };
}

export function useRowDrag(
  onMove: RowMove | undefined,
  options: RowDragOptions = {},
): React.PointerEventHandler<HTMLElement> | undefined {
  return useListDrag(PLACED_ROW, onMove, options);
}

export function useRunRowDrag(
  onMove: RowMove | undefined,
  options: RowDragOptions = {},
): React.PointerEventHandler<HTMLElement> | undefined {
  return useListDrag(RUN_ROW, onMove, options);
}

export function useTaskDrag(
  onMove: RowMove<string> | undefined,
  options: RowDragOptions<string> = {},
): React.PointerEventHandler<HTMLElement> | undefined {
  return useListDrag(TASK_ROW, onMove, options);
}
