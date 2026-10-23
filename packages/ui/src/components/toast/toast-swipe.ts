import { MOTION_DURATION_MS } from "@luke/brand";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type RefObject,
  useRef,
} from "react";

/**
 * toast-swipe.ts -- a toast sent away sideways: dragged by the pointer or swept by a trackpad's two fingers, it follows, flies off past a threshold, and springs back under it.
 *
 * The drag writes the toast's offset to `--luke-toast-drag` alone, which its
 * `translate` reads, and plays nothing while the pointer is down, so the
 * card stays under the finger. Let go past `SWIPE_AWAY` of its width (and no
 * less than `SWIPE_LEAST`), it is marked with the side it went (`data-swiped`)
 * and dismissed, and its exit carries it on off that side; let go short of
 * it, the offset is put back at once and the card springs home from where it
 * was, FLIP-style, on the spring small elements ride, read from the tokens
 * so reduced motion and a capture run play nothing.
 *
 * A trackpad sends no press, only horizontal wheel deltas, so a sweep is
 * the same journey with its end unsaid: each delta moves the card, a delta
 * after `SWIPE_QUIET` with none starts a new sweep, and the spring home is
 * armed to start once that quiet passes, as a delayed animation that holds
 * the card where the sweep left it until then and that the next delta
 * replaces. A press that never travels `SWIPE_SLOP`
 * sideways stays a press, so the toast's buttons still take their clicks.
 */

/** How far, in CSS pixels, a press travels sideways before it is a drag rather than a click. */
const SWIPE_SLOP = 6;

/** How much of its width a toast travels before letting go sends it away. */
const SWIPE_AWAY = 0.35;

/** The least travel, in CSS pixels, that sends a toast away, however narrow it is drawn. */
const SWIPE_LEAST = 64;

/** How long a sweep stands with no wheel delta before the toast springs home: `--luke-duration-quick`'s. */
const SWIPE_QUIET = MOTION_DURATION_MS.QUICK;

/** Which way a toast was sent: the side it leaves by. */
const SWIPE_SIDE = {
  LEFT: "left",
  RIGHT: "right",
} as const;

/** A press under way: where it went down, and whether it has become a drag. */
interface Press {
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  dragging: boolean;
}

/** The handlers a swipeable toast's element takes, and the ref they move it by. */
export interface ToastSwipe {
  readonly ref: RefObject<HTMLLIElement | null>;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLLIElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLLIElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLLIElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLLIElement>) => void;
  readonly onWheel: (event: ReactWheelEvent<HTMLLIElement>) => void;
}

/** Puts the toast at `offset` sideways, as the drag's own frame, playing nothing. */
function place(toast: HTMLLIElement, offset: number): void {
  toast.style.setProperty("--luke-toast-drag", `${offset}px`);
}

/** Whether `offset` has gone far enough to send `toast` away. */
function farEnough(toast: HTMLLIElement, offset: number): boolean {
  return Math.abs(offset) >= Math.max(SWIPE_LEAST, toast.offsetWidth * SWIPE_AWAY);
}

/**
 * Springs the toast home from `offset`, after `delay` milliseconds; the
 * animation, where one plays. Note that reduced motion leaves 1ms rather
 * than none, which is no motion either: a sweep still holds the card where
 * it left it through the delay, then puts it back at once.
 */
function springHome(toast: HTMLLIElement, offset: number, delay: number): Animation | undefined {
  place(toast, 0);
  const style = getComputedStyle(toast);
  const duration = Number.parseFloat(style.getPropertyValue("--luke-duration-fast")) || 0;
  if (offset === 0 || typeof toast.animate !== "function") return undefined;
  if (duration <= 1 && delay === 0) return undefined;
  return toast.animate([{ translate: `${offset}px 0` }, { translate: "0 0" }], {
    duration: Math.max(1, duration),
    delay,
    easing: style.getPropertyValue("--luke-spring-fast").trim(),
    fill: "backwards",
  });
}

/** Lets a toast be swiped away sideways, `onAway` telling whoever owns it to dismiss it. */
export function useToastSwipe(onAway: (() => void) | undefined): ToastSwipe {
  const ref = useRef<HTMLLIElement>(null);
  const press = useRef<Press | undefined>(undefined);
  const offset = useRef(0);
  const home = useRef<Animation | undefined>(undefined);
  const swept = useRef(Number.NEGATIVE_INFINITY);
  const away = (toast: HTMLLIElement) => {
    home.current?.cancel();
    place(toast, offset.current);
    toast.dataset.swiped = offset.current < 0 ? SWIPE_SIDE.LEFT : SWIPE_SIDE.RIGHT;
    onAway?.();
  };
  const letGo = (event: ReactPointerEvent<HTMLLIElement>) => {
    const held = press.current;
    const toast = ref.current;
    if (held === undefined || held.pointer !== event.pointerId || toast === null) return;
    press.current = undefined;
    if (!held.dragging) return;
    delete toast.dataset.dragging;
    if (event.type === "pointerup" && farEnough(toast, offset.current)) away(toast);
    else home.current = springHome(toast, offset.current, 0);
    offset.current = 0;
  };
  return {
    ref,
    onPointerDown: (event) => {
      const toast = ref.current;
      if (onAway === undefined || event.button !== 0 || press.current !== undefined) return;
      if (toast === null || toast.dataset.swiped !== undefined) return;
      press.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        dragging: false,
      };
    },
    onPointerMove: (event) => {
      const held = press.current;
      const toast = ref.current;
      if (held === undefined || held.pointer !== event.pointerId || toast === null) return;
      const dx = event.clientX - held.x;
      if (!held.dragging) {
        // Note that a press travelling up or down first is no swipe, and lets go of the toast.
        if (Math.abs(dx) < SWIPE_SLOP && Math.abs(event.clientY - held.y) < SWIPE_SLOP) return;
        if (Math.abs(dx) < Math.abs(event.clientY - held.y)) {
          press.current = undefined;
          return;
        }
        held.dragging = true;
        home.current?.cancel();
        toast.dataset.dragging = "true";
        // Note that the capture also keeps the click a drag ends in off the button it began on.
        toast.setPointerCapture?.(event.pointerId);
      }
      offset.current = dx;
      place(toast, dx);
    },
    onPointerUp: letGo,
    onPointerCancel: letGo,
    onWheel: (event) => {
      const toast = ref.current;
      if (onAway === undefined || toast === null || press.current !== undefined) return;
      if (toast.dataset.swiped !== undefined) return;
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      home.current?.cancel();
      if (event.timeStamp - swept.current > SWIPE_QUIET) offset.current = 0;
      swept.current = event.timeStamp;
      // Note that the card follows the fingers, which move against the content's scroll.
      offset.current -= event.deltaX;
      if (farEnough(toast, offset.current)) {
        away(toast);
        offset.current = 0;
        return;
      }
      home.current = springHome(toast, offset.current, SWIPE_QUIET);
    },
  };
}
