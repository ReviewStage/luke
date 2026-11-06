import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";

const DRAG_THRESHOLD = 4;

const TAB_PILL = ':scope > .ui-tab:not([data-anchored="true"])';

const DRAGGING_ATTRIBUTE = "data-dragging";

const EDGE_REACH = 32;

const EDGE_SPEED = 12;

interface Slot {
  left: number;
  width: number;
}

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

export type TabMove = (from: number, to: number) => void;

function tabGap(slots: readonly Slot[]): number {
  const first = slots[0];
  const last = slots.at(-1);
  if (first === undefined || last === undefined || slots.length < 2) return 0;
  const widths = slots.reduce((sum, slot) => sum + slot.width, 0);
  return (last.left + last.width - first.left - widths) / (slots.length - 1);
}

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

function aside(press: TabPress, index: number): number {
  const room = (press.slots[press.at]?.width ?? 0) + press.gap;
  if (index > press.at && index <= press.to) return -room;
  if (index < press.at && index >= press.to) return room;
  return 0;
}

function draw(press: TabPress, strip: HTMLElement): void {
  const moved = travel(press, strip.scrollLeft);
  press.to = landing(press, moved);
  press.tabs.forEach((tab, index) => {
    const shift = index === press.at ? moved : aside(press, index);
    tab.style.transform = shift === 0 ? "" : `translateX(${shift}px)`;
  });
}

function lower(press: TabPress, strip: HTMLElement, settle: boolean): void {
  for (const tab of press.tabs) {
    tab.removeAttribute(DRAGGING_ATTRIBUTE);
    if (!settle) tab.style.transition = "none";
    tab.style.transform = "";
  }
  strip.removeAttribute(DRAGGING_ATTRIBUTE);
  if (settle) return;
  strip.getBoundingClientRect();
  for (const tab of press.tabs) tab.style.transition = "";
}

function settleDropped(tab: HTMLElement, left: number): void {
  const shift = left - tab.getBoundingClientRect().left;
  if (shift === 0) return;
  tab.style.transition = "none";
  tab.style.transform = `translateX(${shift}px)`;
  tab.getBoundingClientRect();
  tab.style.transition = "";
  tab.style.transform = "";
}

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
    const runAlong = () => {
      press.frame = undefined;
      const from = strip.scrollLeft;
      const by = edgeRun(press, from);
      if (!press.dragging || by === 0) return;
      strip.style.scrollBehavior = "auto";
      strip.scrollLeft = from + by;
      strip.style.scrollBehavior = "";
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
      const now = [...strip.querySelectorAll<HTMLElement>(TAB_PILL)];
      if (now.length !== press.tabs.length || now.some((each, at) => each !== press.tabs[at])) {
        lower(press, strip, true);
        return;
      }
      const left = tab.getBoundingClientRect().left;
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
    const runBeneath = () => {
      if (press.dragging) draw(press, strip);
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
    if (target.closest(".ui-tab-close, [data-editing]") !== null) return;
    const tabs = [...strip.querySelectorAll<HTMLElement>(TAB_PILL)];
    const at = tabs.findIndex((tab) => tab.contains(target));
    if (at < 0 || tabs.length < 2) return;
    const shown = strip.getBoundingClientRect();
    const view = { left: shown.left, width: shown.width };
    const scrolled = strip.scrollLeft;
    const style = getComputedStyle(strip);
    const between = Number.parseFloat(style.columnGap) || 0;
    let left = Number.parseFloat(style.paddingLeft) || 0;
    const placed = new Map<Element, { left: number; width: number }>();
    for (const pill of strip.querySelectorAll(":scope > .ui-tab")) {
      const width = pill.getBoundingClientRect().width;
      placed.set(pill, { left, width });
      left += width + between;
    }
    const slots = tabs.map((tab) => placed.get(tab) ?? { left: 0, width: 0 });
    const pointer = { pointerId: event.pointerId, x: event.clientX, pointer: event.clientX };
    const press = { ...pointer, scrolled, view, at, tabs, slots, gap: tabGap(slots), to: at };
    begin(strip, { ...press, dragging: false, frame: undefined });
  };
}
