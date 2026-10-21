/**
 * inbox-row-motion.tsx -- how the Inbox's list moves as rows leave it: a row, or a group its last row takes with it, fades where it stood, and what stood under it glides up into its place, while nothing above it moves.
 *
 * A list keeps an entry it no longer lists drawn where it stood, leaving
 * (`useLeaving`), until its exit has played: docs/DESIGN.md's "An element
 * that unmounts is held mounted through its own exit". The leaving entry
 * hands its element to the list's motion (`InboxRowMotion`) as it is drawn,
 * which takes it out of the layout at once, laid over the place it held,
 * out of reach of the pointer and the keyboard, and fades it on the exit's
 * tokens; it is let go once the fade finishes. What the layout moved, every
 * row and group under it, replays the journey FLIP-style on the spring,
 * after the exit, since what leaves goes first; a row arriving fades in on
 * the same beat. Rows above a leaving one never moved in the layout, so
 * nothing plays on them.
 *
 * The one move the layout would still make above it is the scroller's: a
 * list scrolled to its end that grows shorter is scrolled back by the
 * browser as much as it shrank, which carries every row in sight down. So
 * the list's body holds its height while a row leaves, as far down as the
 * scroller shows it, and gives it back only as the reader scrolls up, the
 * room under the last row closing with the scroll rather than by moving
 * what they read.
 */

import { Component, createContext, type RefObject, useContext, useState } from "react";
import { tokenTiming } from "../desktop/pane-motion.js";

/** What the list's motion moves: each group or run of rows under the list's body, and each row of a run. */
const MOVERS = ".inbox-tasks-body > *, .sidebar-tasks > li";

/** The property the list's body holds its height by while a row leaves (`.inbox-tasks-body`). */
const HELD_HEIGHT = "--inbox-held-height";

/** What a leaving row or group wears while it is drawn on, out of reach. */
export const LEAVING = "[data-leaving]";

/** Less than this, in CSS pixels, is not a move worth playing. */
const STILL = 0.5;

/** One entry of a list as drawn: its key, its value as last listed, and whether it is leaving. */
export interface Drawn<T> {
  readonly key: string;
  readonly value: T;
  readonly leaving: boolean;
}

/** A leaving entry's element as the list's motion takes it, and what lets the entry go once its exit has played. */
interface Leaver {
  readonly element: HTMLElement;
  readonly onLeft: () => void;
}

/** Where the leaving entries drawn in a commit wait for the list's motion, which plays their exits in that commit. */
export interface InboxLeaves {
  readonly pending: Leaver[];
}

const LeavesContext = createContext<InboxLeaves | undefined>(undefined);

/** Hands the list's leaving entries to its motion; with none, an entry leaves at once. */
export const InboxLeavesProvider = LeavesContext.Provider;

/** The exits under way, by the element leaving, for an entry listed again before its exit finished to stand again. */
const exits = new WeakMap<Element, Animation>();

/** The glides under way, by the element gliding, stopped where a later change moves it again. */
const glides = new WeakMap<Element, Animation>();

/** Whether the DOM plays motions at all. Note that a test's DOM has no animation engine, and runs none. */
function animates(element: Element): boolean {
  return "animate" in element;
}

/**
 * The entries to draw once `listed` replaces what was drawn: every entry
 * listed, in its order, and every entry drawn that is no longer listed
 * still drawn, leaving, after the entry that stood before it.
 */
function drawnAfter<T>(
  drawn: readonly Drawn<T>[],
  listed: readonly T[],
  keyOf: (value: T) => string,
): Drawn<T>[] {
  const next: Drawn<T>[] = listed.map((value) => ({ key: keyOf(value), value, leaving: false }));
  const keys = new Set(next.map((entry) => entry.key));
  let before: string | undefined;
  for (const entry of drawn) {
    if (!keys.has(entry.key)) {
      const at = before === undefined ? 0 : next.findIndex((each) => each.key === before) + 1;
      next.splice(at, 0, entry.leaving ? entry : { ...entry, leaving: true });
    }
    before = entry.key;
  }
  return next;
}

/** An element whose exit was stopped, its entry listed again, standing as it did before it left. */
function standAgain(element: HTMLElement): void {
  exits.get(element)?.cancel();
  exits.delete(element);
  for (const property of ["position", "top", "left", "width", "margin"]) {
    element.style.removeProperty(property);
  }
  element.removeAttribute("inert");
  delete element.dataset.leaving;
}

/**
 * The entries of a list to draw: those it lists, and those it no longer
 * lists, leaving, until their exit has played. Each leaving entry's element
 * is to wear `leave(key)` as its ref, by which it hands itself to the
 * list's motion; an element inside it, a row's press, finds the row it
 * stands in. Without a motion to hand it to, an entry leaves at once.
 */
export function useLeaving<T>(
  listed: readonly T[],
  keyOf: (value: T) => string,
): {
  drawn: readonly Drawn<T>[];
  leave: (key: string) => React.RefCallback<HTMLElement>;
} {
  const leaves = useContext(LeavesContext);
  const [held, setHeld] = useState(() => ({
    listed,
    drawn: drawnAfter<T>([], listed, keyOf),
  }));
  // Note that what is drawn follows the list as it renders, React's way of
  // keeping what an earlier render drew, so a row leaves on the frame it
  // stops being listed rather than a frame later.
  let { drawn } = held;
  if (held.listed !== listed) {
    drawn = drawnAfter(held.drawn, listed, keyOf);
    setHeld({ listed, drawn });
  }
  const [refs] = useState(() => new Map<string, React.RefCallback<HTMLElement>>());
  const leave = (key: string) => {
    const known = refs.get(key);
    if (known !== undefined) return known;
    let leaving: HTMLElement | null = null;
    const onLeft = () =>
      setHeld((now) => ({
        listed: now.listed,
        drawn: now.drawn.filter((entry) => !(entry.leaving && entry.key === key)),
      }));
    const ref = (element: HTMLElement | null) => {
      if (element === null) {
        // Note that an entry listed again before its exit finished keeps its element, which stands again.
        if (leaving !== null) standAgain(leaving);
        leaving = null;
        refs.delete(key);
        return;
      }
      leaving = element.closest<HTMLElement>(MOVERS) ?? element;
      if (leaves === undefined) onLeft();
      else leaves.pending.push({ element: leaving, onLeft });
    };
    refs.set(key, ref);
    return ref;
  };
  return { drawn, leave };
}

/** Where each mover under `root` is drawn, from the root's top, any glide under way included. */
function placesOf(root: HTMLElement): Map<Element, number> {
  const top = root.getBoundingClientRect().top;
  const places = new Map<Element, number>();
  for (const mover of root.querySelectorAll(MOVERS)) {
    places.set(mover, mover.getBoundingClientRect().top - top);
  }
  return places;
}

/**
 * Takes each leaving element out of the layout, laid over the place it
 * held, and fades it, letting its entry go once the fade has played; at
 * once where there is to be no motion. Note that every place is read
 * before any element leaves, since each that leaves moves the rest.
 */
function playExits(leavers: readonly Leaver[], exit: KeyframeAnimationOptions | undefined): void {
  if (exit === undefined) {
    for (const leaver of leavers) leaver.onLeft();
    return;
  }
  const placed = leavers.map((leaver) => {
    const { element } = leaver;
    return {
      leaver,
      top: element.offsetTop,
      left: element.offsetLeft,
      width: element.offsetWidth,
      opacity: getComputedStyle(element).opacity || "1",
    };
  });
  for (const { leaver, top, left, width, opacity } of placed) {
    const { element, onLeft } = leaver;
    element.style.position = "absolute";
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
    element.style.width = `${width}px`;
    element.style.margin = "0";
    const fade = element.animate([{ opacity }, { opacity: 0 }], { ...exit, fill: "forwards" });
    fade.onfinish = onLeft;
    exits.set(element, fade);
  }
}

/**
 * Replays from `before` what the commit moved under `root`: each mover
 * glides from where it was drawn, less what the group around it moved,
 * which carries it, and a mover new to the list fades in. Both wait out
 * the exit when something left, as what leaves goes first.
 */
function playMoves(
  root: HTMLElement,
  before: Map<Element, number>,
  wait: number,
  travel: KeyframeAnimationOptions,
  arrive: KeyframeAnimationOptions | undefined,
): void {
  const movers = [...root.querySelectorAll<HTMLElement>(MOVERS)].filter(
    (mover) => !exits.has(mover),
  );
  // Note that a glide under way is stopped before anything is read, so each
  // mover is read where the new layout stands it, and all are read at once.
  for (const mover of movers) glides.get(mover)?.cancel();
  const now = placesOf(root);
  const movedBy = (mover: Element): number => {
    const was = before.get(mover);
    const is = now.get(mover);
    return was === undefined || is === undefined ? 0 : was - is;
  };
  for (const mover of movers) {
    if (!before.has(mover)) {
      if (before.size > 0 && arrive !== undefined) {
        mover.animate([{ opacity: 0 }, { opacity: 1 }], {
          ...arrive,
          delay: wait,
          fill: "backwards",
        });
      }
      continue;
    }
    const around = mover.parentElement?.closest(MOVERS);
    const carried =
      around !== null && around !== undefined && root.contains(around) ? movedBy(around) : 0;
    const moved = movedBy(mover) - carried;
    if (Math.abs(moved) < STILL) continue;
    const glide = mover.animate([{ transform: `translateY(${moved}px)` }, { transform: "none" }], {
      ...travel,
      delay: wait,
      fill: "backwards",
    });
    glides.set(mover, glide);
  }
}

/** The nearest element above `element` that scrolls it, if one does. */
function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return undefined;
}

/** How tall what `root` lays out stands, from its top to under its last element in the layout. */
function laidOutHeight(root: HTMLElement): number {
  const top = root.getBoundingClientRect().top;
  let bottom = 0;
  for (const child of root.children) {
    if (exits.has(child) || getComputedStyle(child).position === "absolute") continue;
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom - top);
  }
  return bottom + Number.parseFloat(getComputedStyle(root).paddingBottom || "0");
}

interface InboxRowMotionProps {
  /** The list's body, every row and group under it. */
  root: RefObject<HTMLElement | null>;
  /** Where the list's leaving entries wait for their exits. */
  leaves: InboxLeaves;
  /** What the list draws; a new one is a change to play. */
  change: unknown;
}

/** It holds no state of its own. */
type InboxRowMotionState = Record<never, never>;

/**
 * Plays the list's changes over its body: the exits of what leaves, the
 * glides of what that moved, and the body's height held at the scroller's
 * end. Note that this is a class, as `PaneGlide` is, because
 * `getSnapshotBeforeUpdate` is the one moment React gives to read the
 * layout a commit is about to change; it draws nothing of its own, and is
 * drawn after the rows, so the rows have handed their leaving elements over
 * by the time it plays.
 */
export class InboxRowMotion extends Component<
  InboxRowMotionProps,
  InboxRowMotionState,
  Map<Element, number> | null
> {
  /** Gives back the body's held height and stops following the scroller; none while nothing is held. */
  private release: (() => void) | undefined = undefined;

  override getSnapshotBeforeUpdate(previous: InboxRowMotionProps): Map<Element, number> | null {
    const root = this.props.root.current;
    if (root === null || previous.change === this.props.change || !animates(root)) return null;
    return placesOf(root);
  }

  override componentDidUpdate(
    _previous: InboxRowMotionProps,
    _state: InboxRowMotionState,
    before: Map<Element, number> | null,
  ): void {
    const leavers = this.props.leaves.pending.splice(0);
    // Note that what leaves is out of reach at once, before the list's own
    // effects run, so a row holding the keyboard is seen to have lost it.
    for (const { element } of leavers) {
      element.toggleAttribute("inert", true);
      element.dataset.leaving = "";
    }
    const root = this.props.root.current;
    if (root === null) {
      for (const leaver of leavers) leaver.onLeft();
      return;
    }
    if (leavers.length > 0) this.holdHeight(root);
    const exit = animates(root) ? tokenTiming(root, "--duration-exit", "--motion-exit") : undefined;
    playExits(leavers, exit);
    const travel = tokenTiming(root, "--duration-shape", "--spring");
    if (before === null || travel === undefined) return;
    const wait = leavers.length > 0 && exit !== undefined ? Number(exit.duration) : 0;
    playMoves(root, before, wait, travel, tokenTiming(root, "--duration-quick", "--motion-exit"));
  }

  override componentWillUnmount(): void {
    this.release?.();
  }

  override render(): null {
    return null;
  }

  /**
   * Holds the body as tall as the scroller shows it, so the scroller is
   * never scrolled back as the list shrinks, and gives the height back as
   * the reader scrolls up, all of it once what the body lays out reaches
   * the scroller's foot again or the scroller stands at its top. Note that a
   * scroller at its top is never scrolled back, so nothing is held there.
   */
  private holdHeight(root: HTMLElement): void {
    this.release?.();
    const scroller = scrollerOf(root);
    if (scroller === undefined || scroller.scrollTop <= 0) return;
    const reach = () => scroller.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
    let held = Math.min(root.offsetHeight, reach());
    if (held <= 0) return;
    root.style.setProperty(HELD_HEIGHT, `${held}px`);
    const follow = () => {
      held = Math.min(held, reach());
      if (scroller.scrollTop <= 0 || held <= laidOutHeight(root)) this.release?.();
      else root.style.setProperty(HELD_HEIGHT, `${held}px`);
    };
    scroller.addEventListener("scroll", follow, { passive: true });
    this.release = () => {
      scroller.removeEventListener("scroll", follow);
      root.style.removeProperty(HELD_HEIGHT);
      this.release = undefined;
    };
  }
}
