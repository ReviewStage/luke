/**
 * pane-motion.tsx -- how the window's panes open and close: the work beside them glides to where the change put it, and a pane slides in from its edge or is uncovered as it grows.
 *
 * Nothing here animates a width. A pane opening, closing, or filling the
 * window lands in the layout at once, on the frame it was asked for, and
 * what that moved replays the journey on `transform` and `clip-path`
 * (docs/DESIGN.md, "Whatever its room displaced replays the journey"): the
 * task's tabs, its document or an agent's tab, and its toolbar's buttons
 * glide from where they were drawn to where they now stand, and so does the
 * task's summary as it is pinned or collapses to its rail, the side panel
 * slides in from the window's right, and a panel that grew over the
 * document is uncovered from its old edge to its new one. A pane leaving holds itself drawn
 * through its own exit (side-panel.tsx), so only arrivals and displacement
 * are played here. A smaller pane docked at the right of what it stands
 * beside, a File tab's tree, a Terminal tab's shells, or an automation's
 * Runs, slides in and out on the same tokens (`usePaneSlide`), and an
 * automation's form glides as its Runs come and go, as the document does
 * beside the side panel.
 *
 * Only a change to the panes plays anything. A drag between a pane's bounds
 * changes its width alone, so the edge stays under the pointer frame for
 * frame with nothing easing behind it.
 */

import { Component, type RefObject, useLayoutEffect, useRef, useState } from "react";

/** The content that glides where a pane displaced it, each by its own left edge. */
const GLIDERS = [
  ".desktop-toolbar-heading",
  ".desktop-toolbar-actions",
  ".desktop-document .plan-body",
  ".desktop-agent > *",
  ".desktop-call-bar .call-bar",
  ".desktop-empty > *",
  ".automation-editor",
].join(", ");

/** The pane, read before a change whether or not it is leaving, so one brought back mid-exit carries on from where it was. */
const PANE = ".side-panel";

/** The pane that arrives and grows; one leaving runs its own exit and is left to it. */
const ARRIVING_PANE = ".side-panel:not([data-leaving])";

/** The plan's summary, drawn while the plan is wherever its column spares a rail, so it only ever moves, or arrives with the plan or the room. */
const SUMMARY = ".task-summary";

/** Less than this, in CSS pixels, is not a move worth playing. */
const STILL = 0.5;

/**
 * Which panes are drawn under the root, and how, each by a name of its
 * owner's: the window's sidebar, side panel, and the plan's pinned summary,
 * or an automation's Runs. A change to any of them is what plays.
 */
type PaneLayout = Readonly<Record<string, boolean>>;

/** Where an element was drawn, and how much of it its clip showed. */
interface Drawn {
  rect: DOMRect;
  clip: string;
}

/** Where each glider and the pane stood before a change. */
type Snapshot = Map<Element, Drawn>;

interface PaneGlideProps {
  root: RefObject<HTMLElement | null>;
  layout: PaneLayout;
}

/** It holds no state of its own. */
type PaneGlideState = Record<never, never>;

/** A CSS time, `240ms` or `0.24s`, in milliseconds; anything else is none. */
function milliseconds(value: string): number {
  const match = /^\s*([\d.]+)(ms|s)\s*$/u.exec(value);
  if (match === null) return 0;
  return Number(match[1]) * (match[2] === "s" ? 1000 : 1);
}

/**
 * The timing every pane motion plays on, read from the motion tokens as they
 * stand at `element`, or nothing where there is to be no motion. Reduced
 * motion and a capture run zero the tokens in base.css, so they are answered
 * here as everywhere else, without a check of their own.
 */
export function paneTiming(element: Element): KeyframeAnimationOptions | undefined {
  const style = getComputedStyle(element);
  const duration = milliseconds(style.getPropertyValue("--duration-pane"));
  const easing = style.getPropertyValue("--motion-pane").trim();
  // Note that reduced motion leaves 1ms rather than none, which is no motion either.
  if (duration <= 1 || easing === "") return undefined;
  return { duration, easing };
}

function sameLayout(a: PaneLayout, b: PaneLayout): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name]);
}

/** Where each glider and the pane are drawn now, motion under way included. */
function measure(root: HTMLElement): Snapshot {
  const drawn: Snapshot = new Map();
  for (const element of root.querySelectorAll(`${GLIDERS}, ${PANE}, ${SUMMARY}`)) {
    const clip = element.matches(PANE) ? getComputedStyle(element).clipPath : "none";
    drawn.set(element, { rect: element.getBoundingClientRect(), clip });
  }
  return drawn;
}

/** The motions an element runs. Note that a DOM with no animation engine, a test's, runs none. */
function running(element: Element): Animation[] {
  return "getAnimations" in element ? element.getAnimations() : [];
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
    pane.animate([{ transform: "translateX(100%)" }, { transform: "none" }], timing);
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

/** Replays, from `before`, what the layout change just committed under `root` moved. */
function play(root: HTMLElement, before: Snapshot): void {
  const timing = paneTiming(root);
  if (timing === undefined) return;
  const moved = [...root.querySelectorAll(`${GLIDERS}, ${ARRIVING_PANE}, ${SUMMARY}`)];
  // Note that a motion still under way is stopped before anything is
  // measured, so each element is read where the new layout stands it, and
  // read all at once, so the layout is worked out once rather than per element.
  for (const element of moved) {
    for (const motion of running(element)) motion.cancel();
  }
  const after = moved.map((element) => ({ element, now: element.getBoundingClientRect() }));
  for (const { element, now } of after) {
    const was = before.get(element);
    if (element.matches(PANE)) playPane(element, was, now, timing);
    else if (was !== undefined) glide(element, was.rect.left - now.left, timing);
    // The summary arrives from the window's right, as the side panel does.
    else if (element.matches(SUMMARY)) {
      element.animate([{ transform: "translateX(100%)" }, { transform: "none" }], timing);
    }
  }
}

/**
 * Plays the pane changes over the box at `root`: the window's shell, or an
 * automation's page beside its Runs. Note that this is
 * a class, because `getSnapshotBeforeUpdate` is the one moment React gives to
 * read the layout a commit is about to change, and the glide starts from
 * there; it draws nothing of its own.
 */
export class PaneGlide extends Component<PaneGlideProps, PaneGlideState, Snapshot | null> {
  override getSnapshotBeforeUpdate(previous: PaneGlideProps): Snapshot | null {
    const root = this.props.root.current;
    if (root === null || sameLayout(previous.layout, this.props.layout)) return null;
    return measure(root);
  }

  override componentDidUpdate(
    _previous: PaneGlideProps,
    _state: PaneGlideState,
    before: Snapshot | null,
  ): void {
    const root = this.props.root.current;
    if (root !== null && before !== null) play(root, before);
  }

  override render(): null {
    return null;
  }
}

/** A pane that slides as its owner shows and hides it: whether it is drawn, whether on its way out, and its box. */
export interface PaneSlide {
  drawn: boolean;
  leaving: boolean;
  pane: RefObject<HTMLElement | null>;
}

/**
 * A pane docked at the right of what it stands beside, shown and hidden as
 * the window's panes are (docs/DESIGN.md): it lands in the layout or leaves
 * it at once, so what stands beside it takes or gives its room on the frame
 * the toggle is pressed, and the pane slides in from the right edge, or out
 * past it over what it uncovers, on the pane's own motion tokens. Each
 * slide starts from wherever one under way had brought it. A closed pane is
 * held drawn through its slide out, marked leaving so the stylesheet takes
 * it out of the layout, and let go once it has played; with no motion to
 * play, under reduced motion or a capture run, it is let go before the
 * frame is drawn. A pane its owner opens with stands at once, since nothing
 * was toggled.
 */
export function usePaneSlide(open: boolean): PaneSlide {
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
    if (last.current === open || element === null) return;
    last.current = open;
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
      const start = from === "" || from === "none" ? "translateX(100%)" : from;
      element.animate([{ transform: start }, { transform: "none" }], timing);
      return;
    }
    const exit = element.animate(
      [{ transform: from === "" ? "none" : from }, { transform: "translateX(100%)" }],
      { ...timing, fill: "forwards" },
    );
    exit.onfinish = () => setLeaving(false);
  }, [open]);
  return { drawn: open || leaving, leaving, pane };
}
