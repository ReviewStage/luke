import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

/**
 * use-drawer-swipe.ts -- a phone's drawer swiped in from the screen's left edge, or swiped back out, following the finger and springing open or shut as it is let go.
 *
 * A finger going down near the left edge of the stage while the drawer is
 * away, or on the drawer while it stands, is a swipe in waiting; a finger
 * going down anywhere off the stage is none. It is
 * claimed only once it has gone a few pixels and leans sideways, the way the
 * drawer moves: one that goes up or down first is the page's scroll, and is
 * left to it for the rest of its way. The first `EDGE.MARGIN` of the edge is
 * never claimed, since a browser's own back swipe (Safari's) begins there.
 *
 * While the finger holds it, the drawer and the dimmed window under it
 * follow as one: the stage is marked `data-luke-drawer-drag`, and the share
 * the drawer is open, from 0 to 1, is written to `--luke-drawer-progress` on
 * it, which the drawer's own `transform` and the scrim's `opacity` read with
 * their transitions off, so nothing plays under the finger and no render
 * runs per move. Let go, where the release lands is carried along the
 * finger's speed as it lifts, none where it paused first, so a flick opens
 * or shuts whatever its length; past half way the drawer opens, short of
 * it it shuts. The mark is taken off once the
 * owner has drawn the drawer in its new state, so it travels the rest of the
 * way on its own transition from where the finger left it. A finger the
 * system took away puts the drawer back as it was.
 *
 * Only a finger swipes (`pointerType` touch): a mouse and a pen keep the
 * drawer's toggle alone. A claimed swipe's moves are kept from what lies
 * under the finger, so a row that swipes on its own does not follow too,
 * and its touch moves are held from scrolling the page.
 */

/** The swipe's lengths, in CSS pixels, and its shares. */
const DRAWER_SWIPE = {
  /** The strip at the screen's very edge left to the browser's own back swipe. */
  EDGE_MARGIN: 20,
  /** How far in from the edge a finger may go down and still swipe the drawer in. */
  EDGE_REACH: 44,
  /** How far a finger goes before its way is read. */
  SLOP: 6,
  /** How much more sideways than up or down a swipe must go to be the drawer's. */
  LEAN: 1.5,
  /** Past this share open, a release opens the drawer; short of it, shuts it. */
  OPEN_SHARE: 0.5,
  /** How far ahead a release looks along the finger's speed, in milliseconds, so a flick carries. */
  PROJECT_MS: 160,
  /** How far back the finger's speed is read, in milliseconds. */
  SPEED_WINDOW_MS: 80,
} as const;

/** The stage's mark while a finger holds the drawer, and the share open it carries. */
const DRAG_ATTRIBUTE = "data-luke-drawer-drag";
const PROGRESS_PROPERTY = "--luke-drawer-progress";

/** Where a swipe stands: waiting to be read, or the drawer's. */
const SWIPE_STATE = {
  WAITING: "waiting",
  CLAIMED: "claimed",
} as const;

type SwipeState = (typeof SWIPE_STATE)[keyof typeof SWIPE_STATE];

/** Where the drawer was, and when, by the event's own clock. */
interface Sample {
  readonly at: number;
  readonly progress: number;
}

/** A finger under way: which, where it went down, how open the drawer was, how wide it stands, and its way. */
interface Swipe {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly from: number;
  readonly width: number;
  state: SwipeState;
  readonly samples: Sample[];
}

/** What the swipe is handed: whether it may run, the drawer's state, its boxes, and the doors that open and shut it. */
export interface DrawerSwipeOptions {
  /** Whether a finger may swipe the drawer: a phone's narrow room, worked by a finger. */
  readonly enabled: boolean;
  /** Whether the drawer stands open. */
  readonly open: boolean;
  /** The stage the drawer stands at the left edge of, which carries the mark and the share open. */
  readonly stage: RefObject<HTMLElement | null>;
  /** The drawer itself, whose width the share is read against. */
  readonly drawer: () => HTMLElement | null;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

function clampShare(share: number): number {
  return Math.min(1, Math.max(0, share));
}

/** The finger's speed lately, in share open per millisecond; none where it has not moved long enough to say. */
function speed(samples: readonly Sample[]): number {
  const last = samples.at(-1);
  if (last === undefined) return 0;
  const first = samples.find((sample) => last.at - sample.at <= DRAWER_SWIPE.SPEED_WINDOW_MS);
  if (first === undefined || last.at === first.at) return 0;
  return (last.progress - first.progress) / (last.at - first.at);
}

/** Whether a swipe let go at `progress`, moving at `velocity`, opens the drawer. */
function opensOnRelease(progress: number, velocity: number): boolean {
  return progress + velocity * DRAWER_SWIPE.PROJECT_MS > DRAWER_SWIPE.OPEN_SHARE;
}

/** Whether a finger going down at `x` on `target` may swipe the drawer, given whether it is open. */
function startsSwipe(
  x: number,
  target: EventTarget | null,
  stage: HTMLElement,
  drawer: HTMLElement | null,
  open: boolean,
): boolean {
  if (!(target instanceof Node)) return false;
  if (open) return drawer?.contains(target) === true;
  if (!stage.contains(target)) return false;
  const left = x - stage.getBoundingClientRect().left;
  return left >= DRAWER_SWIPE.EDGE_MARGIN && left <= DRAWER_SWIPE.EDGE_REACH;
}

/**
 * Lets a finger swipe the drawer in from the stage's left edge and back out,
 * as the file's header says. The listeners stand on the window in its
 * capture phase while the swipe is enabled, so a claimed swipe is the
 * drawer's before anything under the finger hears its moves.
 */
export function useDrawerSwipe(options: DrawerSwipeOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const swipe = useRef<Swipe | undefined>(undefined);
  // Whether the stage still carries the mark from a swipe let go, until the drawer is drawn in its new state.
  const settling = useRef(false);
  const { enabled, open, stage } = options;

  useLayoutEffect(() => {
    if (!settling.current) return;
    settling.current = false;
    stage.current?.removeAttribute(DRAG_ATTRIBUTE);
    stage.current?.style.removeProperty(PROGRESS_PROPERTY);
  }, [open, stage]);

  useEffect(() => {
    if (!enabled) return;
    const write = (progress: number) => {
      stage.current?.style.setProperty(PROGRESS_PROPERTY, String(progress));
    };
    const settle = (opens: boolean) => {
      const { open: was, onOpen, onClose } = latest.current;
      if (opens === was) {
        stage.current?.removeAttribute(DRAG_ATTRIBUTE);
        stage.current?.style.removeProperty(PROGRESS_PROPERTY);
        return;
      }
      // Note that the mark stays until the owner has drawn the change, so the drawer travels on from the finger rather than from where it last stood.
      settling.current = true;
      write(opens ? 1 : 0);
      if (opens) onOpen();
      else onClose();
    };
    const down = (event: PointerEvent) => {
      const { open: isOpen, drawer } = latest.current;
      const box = stage.current;
      if (event.pointerType !== "touch" || !event.isPrimary || box === null) return;
      const drawn = drawer();
      if (drawn === null || !startsSwipe(event.clientX, event.target, box, drawn, isOpen)) return;
      const from = isOpen ? 1 : 0;
      swipe.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from,
        width: Math.max(1, drawn.getBoundingClientRect().width),
        state: SWIPE_STATE.WAITING,
        samples: [{ at: event.timeStamp, progress: from }],
      };
    };
    const move = (event: PointerEvent) => {
      const held = swipe.current;
      if (held === undefined || held.pointerId !== event.pointerId) return;
      const dx = event.clientX - held.x;
      const dy = event.clientY - held.y;
      if (held.state === SWIPE_STATE.WAITING) {
        if (Math.abs(dx) < DRAWER_SWIPE.SLOP && Math.abs(dy) < DRAWER_SWIPE.SLOP) return;
        // Note that only the way the drawer can go claims it: in while it is away, out while it stands.
        const toward = held.from === 0 ? dx > 0 : dx < 0;
        if (!toward || Math.abs(dx) < Math.abs(dy) * DRAWER_SWIPE.LEAN) {
          swipe.current = undefined;
          return;
        }
        held.state = SWIPE_STATE.CLAIMED;
        stage.current?.setAttribute(DRAG_ATTRIBUTE, "");
      }
      event.stopPropagation();
      const progress = clampShare(held.from + dx / held.width);
      held.samples.push({ at: event.timeStamp, progress });
      write(progress);
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
      swipe.current = undefined;
      if (held.state !== SWIPE_STATE.CLAIMED) return;
      // Note that the release is a sample of its own, so a finger held still before it lifts carries no speed from before the pause.
      const last = clampShare(held.from + (event.clientX - held.x) / held.width);
      held.samples.push({ at: event.timeStamp, progress: last });
      settle(
        event.type === "pointerup" ? opensOnRelease(last, speed(held.samples)) : held.from === 1,
      );
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
      swipe.current = undefined;
      stage.current?.removeAttribute(DRAG_ATTRIBUTE);
      stage.current?.style.removeProperty(PROGRESS_PROPERTY);
    };
  }, [enabled, stage]);
}
