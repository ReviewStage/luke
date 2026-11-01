/**
 * pane-motion.tsx -- how the window's panes open and close: the work beside them glides to where the change put it, and a pane slides in from its edge or is uncovered as it grows.
 *
 * Nothing here animates a width. A pane opening, closing, or filling the
 * window lands in the layout at once, on the frame it was asked for, and
 * what that moved replays the journey on `transform` and `clip-path`
 * (docs/DESIGN.md, "Whatever its room displaced replays the journey"), as
 * one motion: every part of it starts in the same task on the same timing,
 * and every part runs on the compositor, so a frame the page is late to
 * draw holds none of them back from the rest. The seam a toggle moves, the
 * sidebar's edge or the side panel's, moves the panes either side of it
 * together. The sidebar slides off past the window's left edge or back on,
 * and the side panel in past its right edge, each keeping its gap from the
 * sheet beside it all the way, and that sheet's frame follows them: a sheet
 * the change widened is uncovered from its old edge, and one it narrowed
 * draws its card out to its old edge and is covered back to its new one,
 * its rounded corners riding the moving edge and nothing it holds drawn past
 * it (`playSheet`). What a sheet holds keeps the width it has landed at;
 * the task's tabs, its document or an agent's tab, its toolbar's buttons,
 * and the place's head glide from where they were drawn to where they now
 * stand, and so does the task's summary as it is pinned or collapses to its
 * rail, and a panel that grew over the document is uncovered from its old
 * edge to its new one. A pane leaving holds itself drawn through its own
 * exit (side-panel.tsx), on the same travel (`pastRightEdge`), so only
 * arrivals and displacement are played here. A second press part way
 * through starts every part again from where it had got to; a window
 * resized part way through lands every part where it is going, since the
 * frames were measured for the window as it stood.
 *
 * A smaller pane docked at the right of what it stands beside, a File tab's
 * tree, a Terminal tab's shells, or an automation's Runs, slides in and out
 * on the same tokens (`usePaneSlide`), and an automation's form glides as
 * its Runs come and go, as the document does beside the side panel.
 *
 * Only a change to the panes plays anything. A drag between a pane's bounds
 * changes its width alone, so the edge stays under the pointer frame for
 * frame with nothing easing behind it.
 */

import { MOTION_TOKEN, tokenTiming } from "@luke/ui";
import { Component, type RefObject, useLayoutEffect, useRef, useState } from "react";

/** The content that glides where a pane displaced it, each by its own left edge. */
const GLIDERS = [
  ".luke-toolbar-heading",
  ".luke-toolbar-actions",
  ".desktop-document .plan-body",
  ".desktop-agent > *",
  ".desktop-empty-region > *",
  ".automation-editor",
].join(", ");

/** The pane, read before a change whether or not it is leaving, so one brought back mid-exit carries on from where it was. */
const PANE = ".side-panel";

/** The pane that arrives and grows; one leaving runs its own exit and is left to it. */
const ARRIVING_PANE = ".side-panel:not([data-leaving])";

/** The plan's summary, drawn while the plan is wherever its column spares a rail, so it only ever moves, or arrives with the plan or the room. */
const SUMMARY = ".task-summary";

/**
 * The sheets whose edges a pane change can move: each column drawn on a card
 * of its own under its row (shell.css), as its `::before`. A sheet whose
 * page draws no card is skipped where it is played. The side panel is a
 * sheet too, but moves whole (`playPane`).
 */
const SHEETS =
  ".desktop-shell > .desktop-main, .desktop-task > :is(.desktop-task-main, .agent-page, .page-find)";

/** The window's sidebar, folded by sliding it off past the window's left edge. */
const SIDEBAR = ".desktop-shell > .desktop-sidebar";

/** Everything a pane change may move. */
const MOVED = `${GLIDERS}, ${ARRIVING_PANE}, ${SUMMARY}, ${SHEETS}, ${SIDEBAR}`;

/** How far a sheet's card reaches past its box while it is drawn out to an edge it no longer stands at (shell.css). */
const REACH = {
  LEFT: "--sheet-reach-left",
  RIGHT: "--sheet-reach-right",
} as const;

/** How far a sheet's frame stands out past its card: the card's hairline. */
const HAIRLINE = 1;

/** How far a sheet's frame reaches above its row and below its card, so its row and the shadow under it are drawn whole. */
const BLEED = 48;

/** The name every pane motion plays under, so the window can find them all. */
const PANE_MOTION = "pane";

/** Less than this, in CSS pixels, is not a move worth playing. */
const STILL = 0.5;

/**
 * Which panes are drawn under the root, and how, each by a name of its
 * owner's: the window's sidebar, side panel, and the plan's pinned summary,
 * or an automation's Runs. A change to any of them is what plays.
 */
type PaneLayout = Readonly<Record<string, boolean>>;

/** A sheet's left and right edges in the window, in CSS pixels. */
interface Edges {
  left: number;
  right: number;
}

/** Where an element was drawn, how much of it its clip showed, how it was moved, and, for a sheet, where its frame stood. */
interface Drawn {
  rect: DOMRect;
  clip: string;
  transform: string;
  frame: Edges;
}

/** Where each glider and the pane stood before a change. */
type Snapshot = Map<Element, Drawn>;

/** A sheet's frame on its way from one pair of edges to another. */
interface SheetMotion {
  from: Edges;
  to: Edges;
  motion: Animation;
}

/** The sheets whose frames are moving, each by its own motion. */
type SheetMotions = WeakMap<Element, SheetMotion>;

interface PaneGlideProps {
  root: RefObject<HTMLElement | null>;
  layout: PaneLayout;
}

/** It holds no state of its own. */
type PaneGlideState = Record<never, never>;

/**
 * The timing every pane motion plays on, read from the motion tokens as they
 * stand at `element`, or nothing where there is to be no motion. Reduced
 * motion and a capture run zero the tokens in base.css, so they are answered
 * here as everywhere else, without a check of their own.
 */
export function paneTiming(element: Element): KeyframeAnimationOptions | undefined {
  const timing = tokenTiming(element, MOTION_TOKEN.DURATION_PANE, MOTION_TOKEN.EASE_PANE);
  return timing === undefined ? undefined : { ...timing, id: PANE_MOTION };
}

function sameLayout(a: PaneLayout, b: PaneLayout): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name]);
}

/**
 * Whether an element is drawn at all. Note that one under a page kept hidden
 * (the Inbox's, `desktop-shell.tsx`) is not, and so has nowhere to glide from
 * or to; a DOM with no layout, a test's, draws everything.
 */
function isDrawn(element: Element): boolean {
  return !("checkVisibility" in element) || element.checkVisibility();
}

/**
 * Where a sheet's frame stands: where its box does, or, part way through a
 * motion, where that motion has brought it. Note that the progress read is
 * the eased one, the share of the way the frame has gone.
 */
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

/** Where each glider, pane, and sheet is drawn now, motion under way included. */
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
      frame: frameOf(rect, sheets.get(element)),
    });
  }
  return drawn;
}

/** The motions an element runs. Note that a DOM with no animation engine, a test's, runs none. */
function running(element: Element): Animation[] {
  return "getAnimations" in element ? element.getAnimations() : [];
}

/**
 * Stops what moves an element, a sheet's drawn-out card included, so it
 * stands where the layout puts it. Note that this also stops a transition
 * its stylesheet started for the change, the sidebar's, because asking for
 * its motions brings its style up to date first.
 */
function stop(element: Element, sheets: SheetMotions): void {
  for (const motion of running(element)) motion.cancel();
  if (!sheets.has(element) || !(element instanceof HTMLElement)) return;
  sheets.delete(element);
  element.style.removeProperty(REACH.LEFT);
  element.style.removeProperty(REACH.RIGHT);
}

/**
 * Where a pane at the window's right edge stands once slid out past it: past
 * its own width and the gap it keeps from the sheet beside it, so that as the
 * sheet's edge follows it the two keep that gap all the way.
 */
export function pastRightEdge(pane: Element): string {
  const gap = Number.parseFloat(getComputedStyle(pane).getPropertyValue("--sheet-gap"));
  return gap > 0 ? `translateX(calc(100% + ${gap}px))` : "translateX(100%)";
}

/** Plays a translation from `dx` back to where the element stands. */
function glide(element: Element, dx: number, timing: KeyframeAnimationOptions): void {
  if (Math.abs(dx) < STILL) return;
  element.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], timing);
}

/**
 * The side panel's part: in from the window's right where it was not drawn
 * before, uncovered from its old left edge where it grew (into full screen,
 * or as the window gave it back room), and moved like any glider where only
 * its place changed. A pane brought back part way through its exit carries
 * on from there: uncovered again from the clip it had reached, or moved back
 * from where its slide had taken it.
 */
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
  // Note that a pane the change narrowed lands at once: moving it would part
  // it from the window's edge, and clipping cannot draw what it no longer is.
  else if (grown >= STILL) {
    pane.animate([{ clipPath: `inset(0 0 0 ${grown}px)` }, { clipPath: "inset(0)" }], timing);
  }
}

/**
 * The clip a sheet's frame draws, as a path over its box of `width` and
 * `height`: its left side `left` in from the box's, and its right side
 * `right` in, each out past it where negative, with its card's top at `top`
 * rounded by `radius` at each side, and its row above the card whole. Note
 * that the corners are cut by a notch rather than drawn as the card's top
 * edge, because the row above stands in the same frame, and that the frame
 * is a `path()` rather than an `inset()`, which rounds only the box's own
 * corners, or a `shape()`, whose arcs Chromium does not play on the
 * compositor, which would let the frame fall behind what it holds.
 */
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

/**
 * A sheet's part: its frame from the edges it stood at to its box, each
 * side riding from its old place to its new one. Note that a side that does
 * not move is held at its card's hairline too, rather than clear of its
 * shadow, because what glides inside the sheet would otherwise be drawn past
 * its edge into the gap beside it. A sheet the change narrowed
 * draws its card out to its old edges first (`REACH`), and lets them go
 * with the clip once the motion ends, in the one task, so no frame shows
 * the card past its frame.
 */
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

/**
 * The sidebar's part: from wherever it stood, a slide under way included, to
 * where its fold now puts it, drawn whole all the way, since its stylesheet
 * hides it once it is folded away.
 */
function playSidebar(sidebar: Element, was: Drawn, timing: KeyframeAnimationOptions): void {
  const now = getComputedStyle(sidebar).transform;
  if (now === was.transform) return;
  sidebar.animate(
    [
      { transform: was.transform, opacity: 1 },
      { transform: now, opacity: 1 },
    ],
    timing,
  );
}

/** Replays, from `before`, what the layout change just committed under `root` moved. */
function play(root: HTMLElement, before: Snapshot, sheets: SheetMotions): void {
  const timing = paneTiming(root);
  if (timing === undefined) return;
  const moved = [...root.querySelectorAll(MOVED)].filter(isDrawn);
  // Note that a motion still under way is stopped before anything is
  // measured, so each element is read where the new layout stands it, and
  // read all at once, so the layout is worked out once rather than per element.
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
    // The summary arrives from the window's right, as the side panel does.
    else if (element.matches(SUMMARY)) {
      element.animate([{ transform: "translateX(100%)" }, { transform: "none" }], timing);
    }
  }
}

/**
 * Plays the pane changes over the box at `root`: the window's shell, an
 * automation's page beside its Runs. Note that this is
 * a class, because `getSnapshotBeforeUpdate` is the one moment React gives to
 * read the layout a commit is about to change, and the glide starts from
 * there; it draws nothing of its own.
 */
export class PaneGlide extends Component<PaneGlideProps, PaneGlideState, Snapshot | null> {
  readonly #sheets: SheetMotions = new WeakMap();

  /** The frame waited on before the window's panes play anything, while it stands. */
  #opening: number | undefined;

  /**
   * Lands every pane motion under way where it is going, as the window is
   * resized under it, since what each plays was measured for the window as
   * it stood.
   */
  readonly #land = (): void => {
    for (const motion of document.getAnimations()) {
      if (motion.id === PANE_MOTION) motion.finish();
    }
  };

  /**
   * Note that the window plays nothing until it has drawn twice, because
   * what it opens with settles over its first frames, a summary's pin
   * waiting on its column's width among it, and none of that is a change
   * anyone asked for: the window opens as it stands.
   */
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

/** Which edge of what it stands beside a pane is docked at, and slides in from and out past. */
export const PANE_EDGE = {
  RIGHT: "right",
  LEFT: "left",
} as const;

export type PaneEdge = (typeof PANE_EDGE)[keyof typeof PANE_EDGE];

/** Where a pane stands once slid out past its edge. */
const PAST_EDGE = {
  [PANE_EDGE.RIGHT]: "translateX(100%)",
  [PANE_EDGE.LEFT]: "translateX(-100%)",
} as const satisfies Record<PaneEdge, string>;

/** A pane that slides as its owner shows and hides it: whether it is drawn, whether on its way out, and its box. */
export interface PaneSlide {
  drawn: boolean;
  leaving: boolean;
  pane: RefObject<HTMLElement | null>;
}

/**
 * A pane docked at the right of what it stands beside, or at its left
 * (`edge`), as the Chapters view's rail is, shown and hidden as
 * the window's panes are (docs/DESIGN.md): it lands in the layout or leaves
 * it at once, so what stands beside it takes or gives its room on the frame
 * the toggle is pressed, and the pane slides in from its edge, or out
 * past it over what it uncovers, on the pane's own motion tokens. Each
 * slide starts from wherever one under way had brought it. A closed pane is
 * held drawn through its slide out, marked leaving so the stylesheet takes
 * it out of the layout, and let go once it has played; with no motion to
 * play, under reduced motion or a capture run, it is let go before the
 * frame is drawn. A pane its owner opens with stands at once, since nothing
 * was toggled.
 */
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
    // Note that a pane its owner draws nowhere, a tab too narrow to stand it beside, has no exit to play, so is let go at once.
    if (element === null) {
      if (!open) setLeaving(false);
      return;
    }
    const timing = paneTiming(element);
    // Note that the slide under way is read before it is stopped, because
    // the next one starts from where it had brought the pane, and that it is
    // stopped even with no motion to play, because an exit's fill would
    // otherwise hold a pane shown again past the edge.
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
