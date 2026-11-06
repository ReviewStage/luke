import { MOTION_TOKEN, tokenTiming } from "@repo/ui";
import { Component, type RefObject, useLayoutEffect, useRef, useState } from "react";

const GLIDERS = [
  ".ui-toolbar-heading",
  ".ui-toolbar-actions",
  ".desktop-document .description-body",
  ".desktop-agent > *",
  ".desktop-empty-region > *",
  ".automation-editor",
].join(", ");

const PANE = ".side-panel";

const ARRIVING_PANE = ".side-panel:not([data-leaving])";

const SUMMARY = ".task-summary";

const SHEETS =
  ".desktop-shell > .desktop-main, .desktop-task > :is(.desktop-task-main, .agent-page, .page-find)";

const SIDEBAR = ".desktop-shell > .desktop-sidebar";

const MOVED = `${GLIDERS}, ${ARRIVING_PANE}, ${SUMMARY}, ${SHEETS}, ${SIDEBAR}`;

const REACH = {
  LEFT: "--sheet-reach-left",
  RIGHT: "--sheet-reach-right",
} as const;

const HAIRLINE = 1;

const BLEED = 48;

const PANE_MOTION = "pane";

const STILL = 0.5;

type PaneLayout = Readonly<Record<string, boolean>>;

interface Edges {
  left: number;
  right: number;
}

interface Drawn {
  rect: DOMRect;
  clip: string;
  transform: string;
  opacity: string;
  frame: Edges;
}

type Snapshot = Map<Element, Drawn>;

interface SheetMotion {
  from: Edges;
  to: Edges;
  motion: Animation;
}

type SheetMotions = WeakMap<Element, SheetMotion>;

interface PaneGlideProps {
  root: RefObject<HTMLElement | null>;
  layout: PaneLayout;
}

type PaneGlideState = Record<never, never>;

export function paneTiming(element: Element): KeyframeAnimationOptions | undefined {
  const timing = tokenTiming(element, MOTION_TOKEN.DURATION_PANE, MOTION_TOKEN.EASE_PANE);
  return timing === undefined ? undefined : { ...timing, id: PANE_MOTION };
}

function sameLayout(a: PaneLayout, b: PaneLayout): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name]);
}

function isDrawn(element: Element): boolean {
  return !("checkVisibility" in element) || element.checkVisibility();
}

function frameOf(rect: DOMRect, moving: SheetMotion | undefined): Edges {
  const progress = moving?.motion.effect?.getComputedTiming().progress;
  if (moving === undefined || progress === undefined || progress === null) {
    return { left: rect.left, right: rect.right };
  }
  const { from, to } = moving;
  return {
    left: from.left + (to.left - from.left) * progress,
    right: from.right + (to.right - from.right) * progress,
  };
}

function measure(root: HTMLElement, sheets: SheetMotions): Snapshot {
  const drawn: Snapshot = new Map();
  for (const element of root.querySelectorAll(`${MOVED}, ${PANE}`)) {
    if (!isDrawn(element)) continue;
    const rect = element.getBoundingClientRect();
    const style = element.matches(`${PANE}, ${SIDEBAR}`) ? getComputedStyle(element) : undefined;
    drawn.set(element, {
      rect,
      clip: style?.clipPath ?? "none",
      transform: style?.transform ?? "none",
      opacity: style?.opacity ?? "1",
      frame: frameOf(rect, sheets.get(element)),
    });
  }
  return drawn;
}

function running(element: Element): Animation[] {
  return "getAnimations" in element ? element.getAnimations() : [];
}

function stop(element: Element, sheets: SheetMotions): void {
  for (const motion of running(element)) motion.cancel();
  if (!sheets.has(element) || !(element instanceof HTMLElement)) return;
  sheets.delete(element);
  element.style.removeProperty(REACH.LEFT);
  element.style.removeProperty(REACH.RIGHT);
}

export function pastRightEdge(pane: Element): string {
  const gap = Number.parseFloat(getComputedStyle(pane).getPropertyValue("--sheet-gap"));
  return gap > 0 ? `translateX(calc(100% + ${gap}px))` : "translateX(100%)";
}

function glide(element: Element, dx: number, timing: KeyframeAnimationOptions): void {
  if (Math.abs(dx) < STILL) return;
  element.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], timing);
}

function playPane(
  pane: Element,
  was: Drawn | undefined,
  now: DOMRect,
  timing: KeyframeAnimationOptions,
): void {
  if (was === undefined) {
    pane.animate([{ transform: pastRightEdge(pane) }, { transform: "none" }], timing);
    return;
  }
  const grown = was.rect.left - now.left;
  const sameWidth = Math.abs(was.rect.width - now.width) < STILL;
  if (sameWidth && was.clip.startsWith("inset(")) {
    pane.animate([{ clipPath: was.clip }, { clipPath: "inset(0)" }], timing);
  } else if (sameWidth) glide(pane, grown, timing);
  else if (grown >= STILL) {
    pane.animate([{ clipPath: `inset(0 0 0 ${grown}px)` }, { clipPath: "inset(0)" }], timing);
  }
}

function framePath(
  width: number,
  height: number,
  left: number,
  right: number,
  top: number,
  radius: number,
): string {
  const corner = radius + HAIRLINE;
  const cardTop = top - HAIRLINE;
  const notch = cardTop - 2 * HAIRLINE;
  const bottom = height + HAIRLINE;
  const start = left;
  const end = width - right;
  const arc = `A ${corner} ${corner} 0 0 1`;
  return `path("M ${start} ${-BLEED} H ${end} V ${notch} H ${end - corner} V ${cardTop} ${arc} ${end} ${cardTop + corner} V ${bottom - corner} ${arc} ${end - corner} ${bottom} V ${height + BLEED} H ${start + corner} V ${bottom} ${arc} ${start} ${bottom - corner} V ${cardTop + corner} ${arc} ${start + corner} ${cardTop} V ${notch} H ${start} Z")`;
}

function playSheet(
  sheet: Element,
  was: Edges,
  now: DOMRect,
  timing: KeyframeAnimationOptions,
  sheets: SheetMotions,
): void {
  const left = was.left - now.left;
  const right = now.right - was.right;
  if (Math.abs(left) < STILL && Math.abs(right) < STILL) return;
  if (!(sheet instanceof HTMLElement)) return;
  const card = getComputedStyle(sheet, "::before");
  const top = Number.parseFloat(card.top);
  const radius = Number.parseFloat(card.borderTopLeftRadius);
  if (card.content === "none" || !Number.isFinite(top) || !Number.isFinite(radius)) return;
  const frame = (from: number, to: number) =>
    framePath(now.width, now.height, from - HAIRLINE, to - HAIRLINE, top, radius);
  if (left < 0) sheet.style.setProperty(REACH.LEFT, `${-left}px`);
  if (right < 0) sheet.style.setProperty(REACH.RIGHT, `${-right}px`);
  const motion = sheet.animate([{ clipPath: frame(left, right) }, { clipPath: frame(0, 0) }], {
    ...timing,
    fill: "forwards",
  });
  sheets.set(sheet, { from: was, to: { left: now.left, right: now.right }, motion });
  motion.onfinish = () => stop(sheet, sheets);
}

function playSidebar(sidebar: Element, was: Drawn, timing: KeyframeAnimationOptions): void {
  const now = getComputedStyle(sidebar);
  if (now.transform === was.transform && now.opacity === was.opacity) return;
  sidebar.animate(
    [
      { transform: was.transform, opacity: was.opacity },
      { transform: now.transform, opacity: now.opacity },
    ],
    timing,
  );
}

function play(root: HTMLElement, before: Snapshot, sheets: SheetMotions): void {
  const timing = paneTiming(root);
  if (timing === undefined) return;
  const moved = [...root.querySelectorAll(MOVED)].filter(isDrawn);
  for (const element of moved) stop(element, sheets);
  const after = moved.map((element) => ({ element, now: element.getBoundingClientRect() }));
  for (const { element, now } of after) {
    const was = before.get(element);
    if (element.matches(PANE)) playPane(element, was, now, timing);
    else if (element.matches(SIDEBAR)) {
      if (was !== undefined) playSidebar(element, was, timing);
    } else if (element.matches(SHEETS)) {
      if (was !== undefined) playSheet(element, was.frame, now, timing, sheets);
    } else if (was !== undefined) glide(element, was.rect.left - now.left, timing);
    else if (element.matches(SUMMARY)) {
      element.animate([{ transform: "translateX(100%)" }, { transform: "none" }], timing);
    }
  }
}

export class PaneGlide extends Component<PaneGlideProps, PaneGlideState, Snapshot | null> {
  readonly #sheets: SheetMotions = new WeakMap();

  #opening: number | undefined;

  readonly #land = (): void => {
    for (const motion of document.getAnimations()) {
      if (motion.id === PANE_MOTION) motion.finish();
    }
  };

  override componentDidMount(): void {
    window.addEventListener("resize", this.#land);
    this.#opening = requestAnimationFrame(() => {
      this.#opening = requestAnimationFrame(() => {
        this.#opening = undefined;
      });
    });
  }

  override componentWillUnmount(): void {
    window.removeEventListener("resize", this.#land);
    if (this.#opening !== undefined) cancelAnimationFrame(this.#opening);
  }

  override getSnapshotBeforeUpdate(previous: PaneGlideProps): Snapshot | null {
    const root = this.props.root.current;
    if (root === null || this.#opening !== undefined) return null;
    if (sameLayout(previous.layout, this.props.layout)) return null;
    return measure(root, this.#sheets);
  }

  override componentDidUpdate(
    _previous: PaneGlideProps,
    _state: PaneGlideState,
    before: Snapshot | null,
  ): void {
    const root = this.props.root.current;
    if (root !== null && before !== null) play(root, before, this.#sheets);
  }

  override render(): null {
    return null;
  }
}

export const PANE_EDGE = {
  RIGHT: "right",
  LEFT: "left",
} as const;

export type PaneEdge = (typeof PANE_EDGE)[keyof typeof PANE_EDGE];

const PAST_EDGE = {
  [PANE_EDGE.RIGHT]: "translateX(100%)",
  [PANE_EDGE.LEFT]: "translateX(-100%)",
} as const satisfies Record<PaneEdge, string>;

export interface PaneSlide {
  drawn: boolean;
  leaving: boolean;
  pane: RefObject<HTMLElement | null>;
}

export function usePaneSlide(open: boolean, edge: PaneEdge = PANE_EDGE.RIGHT): PaneSlide {
  const pane = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  if (shown !== open) {
    setShown(open);
    setLeaving(!open);
  }
  const last = useRef(open);
  useLayoutEffect(() => {
    const element = pane.current;
    if (last.current === open) return;
    last.current = open;
    if (element === null) {
      if (!open) setLeaving(false);
      return;
    }
    const timing = paneTiming(element);
    const from = getComputedStyle(element).transform;
    for (const motion of running(element)) motion.cancel();
    if (timing === undefined) {
      if (!open) setLeaving(false);
      return;
    }
    if (open) {
      const start = from === "" || from === "none" ? PAST_EDGE[edge] : from;
      element.animate([{ transform: start }, { transform: "none" }], timing);
      return;
    }
    const exit = element.animate(
      [{ transform: from === "" ? "none" : from }, { transform: PAST_EDGE[edge] }],
      { ...timing, fill: "forwards" },
    );
    exit.onfinish = () => setLeaving(false);
  }, [open, edge]);
  return { drawn: open || leaving, leaving, pane };
}
