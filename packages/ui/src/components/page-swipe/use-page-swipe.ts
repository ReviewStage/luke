/**
 * use-page-swipe.ts -- a finger swiping sideways across a set of pages walks to the next or the previous one, as a phone's photo viewer does, the page following the finger until it is let go.
 *
 * A finger going down on the surface is a swipe in waiting. It is claimed
 * only once it has gone a few pixels and leans sideways: one that goes up or
 * down first is left to whatever lies under it for the rest of its way, and
 * one that goes down on something that scrolls sideways itself, such as a
 * long line of code, or on a field, such as a video's scrubber, is never
 * claimed. A second finger going down makes it a pinch, which is no swipe.
 *
 * While the finger holds it, the surface is marked `data-luke-page-swipe`
 * and how far the finger has gone, in CSS pixels, is written to
 * `--luke-page-swipe-offset` on it, which the page shown reads as its
 * `translate`, so nothing renders per move. Let go, where the release lands
 * is carried along the finger's speed as it lifts, so a flick walks whatever
 * its length; past a share of the surface's width, the swipe walks a page
 * the way the finger went (left to the next, right to the previous), and
 * short of it the page goes back. The mark comes off as it is let go, so a
 * page left in place travels back on its own transition, and the page walked
 * to stands in its place at once.
 *
 * Only a finger swipes (`pointerType` touch): a mouse and a pen keep their
 * own drags. A claimed swipe's moves are kept from what lies under the
 * finger, so a picture under it does not move too, and its touch moves are
 * held from scrolling the page.
 */

import { type RefObject, useEffect, useRef } from "react";

/** The swipe's lengths, in CSS pixels, and its shares. */
const PAGE_SWIPE = {
  /** How far a finger goes before its way is read. */
  SLOP: 8,
  /** How much more sideways than up or down a swipe must go to be the surface's. */
  LEAN: 1.5,
  /** Past this share of the surface's width, a release walks a page; short of it, the page goes back. */
  WALK_SHARE: 0.25,
  /** How far ahead a release looks along the finger's speed, in milliseconds, so a flick carries. */
  PROJECT_MS: 160,
  /** How far back the finger's speed is read, in milliseconds. */
  SPEED_WINDOW_MS: 80,
} as const;

/** The surface's mark while a finger holds it, and how far the finger has gone. */
const SWIPE_ATTRIBUTE = "data-luke-page-swipe";
const OFFSET_PROPERTY = "--luke-page-swipe-offset";

/** What a sideways overflow says where a box scrolls along it. */
const SCROLLING_OVERFLOW = new Set(["auto", "scroll"]);

/** Where a swipe stands: waiting to be read, or the surface's. */
const SWIPE_STATE = {
  WAITING: "waiting",
  CLAIMED: "claimed",
} as const;

type SwipeState = (typeof SWIPE_STATE)[keyof typeof SWIPE_STATE];

/** How far the finger had gone, and when, by the event's own clock. */
interface Sample {
  readonly at: number;
  readonly offset: number;
}

/** A finger under way: which, where it went down, how wide the surface stands, and its way. */
interface Swipe {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  state: SwipeState;
  readonly samples: Sample[];
}

/** What the swipe is handed: whether it may run, the surface it is heard on, and the door that walks a page. */
export interface PageSwipeOptions {
  /** Whether a finger may swipe: there is another page to walk to, and nothing under the finger, such as a zoomed picture, takes its drag. */
  readonly enabled: boolean;
  /** The surface a swipe begins on, which carries the mark and the offset while a finger holds it. */
  readonly surface: RefObject<HTMLElement | null>;
  /** Walks one page on (`1`, swiped left) or back (`-1`, swiped right). */
  readonly onStep: (step: 1 | -1) => void;
}

/** The finger's speed lately, in pixels per millisecond; none where it has not moved long enough to say. */
function speed(samples: readonly Sample[]): number {
  const last = samples.at(-1);
  if (last === undefined) return 0;
  const first = samples.find((sample) => last.at - sample.at <= PAGE_SWIPE.SPEED_WINDOW_MS);
  if (first === undefined || last.at === first.at) return 0;
  return (last.offset - first.offset) / (last.at - first.at);
}

/** The page a swipe let go `offset` along, moving at `velocity`, walks to: on, back, or none. */
function stepOnRelease(offset: number, velocity: number, width: number): 1 | -1 | undefined {
  const landed = offset + velocity * PAGE_SWIPE.PROJECT_MS;
  if (Math.abs(landed) <= width * PAGE_SWIPE.WALK_SHARE) return undefined;
  return landed < 0 ? 1 : -1;
}

/** Whether `target`, or a box between it and `surface`, is a field or scrolls sideways itself, which keeps a finger on it. */
function keepsFinger(target: Element, surface: HTMLElement): boolean {
  for (let box: Element | null = target; box !== null && box !== surface; box = box.parentElement) {
    if (box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement) return true;
    if (box.scrollWidth <= box.clientWidth) continue;
    if (SCROLLING_OVERFLOW.has(getComputedStyle(box).overflowX)) return true;
  }
  return false;
}

/**
 * Lets a finger swipe the surface's pages, as the file's header says. The
 * listeners stand on the window in its capture phase while the swipe is
 * enabled, so a claimed swipe is the surface's before anything under the
 * finger hears its moves.
 */
export function usePageSwipe(options: PageSwipeOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const swipe = useRef<Swipe | undefined>(undefined);
  const { enabled, surface } = options;

  useEffect(() => {
    if (!enabled) return;
    const unmark = () => {
      surface.current?.removeAttribute(SWIPE_ATTRIBUTE);
      surface.current?.style.removeProperty(OFFSET_PROPERTY);
    };
    const drop = () => {
      swipe.current = undefined;
      unmark();
    };
    const down = (event: PointerEvent) => {
      // A second finger makes the swipe a pinch, which is no swipe.
      if (swipe.current !== undefined) {
        drop();
        return;
      }
      const box = surface.current;
      const target = event.target;
      if (event.pointerType !== "touch" || !event.isPrimary || box === null) return;
      if (!(target instanceof Element) || !box.contains(target) || keepsFinger(target, box)) return;
      swipe.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        width: Math.max(1, box.getBoundingClientRect().width),
        state: SWIPE_STATE.WAITING,
        samples: [{ at: event.timeStamp, offset: 0 }],
      };
    };
    const move = (event: PointerEvent) => {
      const held = swipe.current;
      if (held === undefined || held.pointerId !== event.pointerId) return;
      const dx = event.clientX - held.x;
      const dy = event.clientY - held.y;
      if (held.state === SWIPE_STATE.WAITING) {
        if (Math.abs(dx) < PAGE_SWIPE.SLOP && Math.abs(dy) < PAGE_SWIPE.SLOP) return;
        if (Math.abs(dx) < Math.abs(dy) * PAGE_SWIPE.LEAN) {
          swipe.current = undefined;
          return;
        }
        held.state = SWIPE_STATE.CLAIMED;
        surface.current?.setAttribute(SWIPE_ATTRIBUTE, "");
      }
      event.stopPropagation();
      held.samples.push({ at: event.timeStamp, offset: dx });
      surface.current?.style.setProperty(OFFSET_PROPERTY, `${String(dx)}px`);
    };
    const touchMove = (event: TouchEvent) => {
      const held = swipe.current;
      const touch = event.touches[0];
      if (held === undefined || touch === undefined || !event.cancelable) return;
      // Note that a move still being read is held from the page while it leans sideways, since a scroll the browser starts now cannot be taken back.
      const sideways = Math.abs(touch.clientX - held.x) >= Math.abs(touch.clientY - held.y);
      if (held.state === SWIPE_STATE.CLAIMED || sideways) event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      const held = swipe.current;
      if (held === undefined || held.pointerId !== event.pointerId) return;
      drop();
      if (held.state !== SWIPE_STATE.CLAIMED || event.type !== "pointerup") return;
      // Note that the release is a sample of its own, so a finger held still before it lifts carries no speed from before the pause.
      const offset = event.clientX - held.x;
      held.samples.push({ at: event.timeStamp, offset });
      const step = stepOnRelease(offset, speed(held.samples), held.width);
      if (step !== undefined) latest.current.onStep(step);
    };
    const capture = { capture: true } as const;
    window.addEventListener("pointerdown", down, capture);
    window.addEventListener("pointermove", move, capture);
    window.addEventListener("pointerup", up, capture);
    window.addEventListener("pointercancel", up, capture);
    window.addEventListener("touchmove", touchMove, { capture: true, passive: false });
    return () => {
      window.removeEventListener("pointerdown", down, capture);
      window.removeEventListener("pointermove", move, capture);
      window.removeEventListener("pointerup", up, capture);
      window.removeEventListener("pointercancel", up, capture);
      window.removeEventListener("touchmove", touchMove, capture);
      drop();
    };
  }, [enabled, surface]);
}
