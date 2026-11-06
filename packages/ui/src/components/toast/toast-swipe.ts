import { MOTION_DURATION_MS } from "@repo/brand";
import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type RefObject,
  useRef,
} from "react";
import { MOTION_TOKEN, tokenTiming } from "../../motion-timing.js";

const SWIPE_SLOP = 6;

const SWIPE_AWAY = 0.35;

const SWIPE_LEAST = 64;

const SWIPE_QUIET = MOTION_DURATION_MS.QUICK;

const HELD = { duration: 1 } as const;

const SWIPE_SIDE = {
  LEFT: "left",
  RIGHT: "right",
} as const;

interface Press {
  readonly pointer: number;
  readonly x: number;
  readonly y: number;
  dragging: boolean;
}

export interface ToastSwipe {
  readonly ref: RefObject<HTMLLIElement | null>;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLLIElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLLIElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLLIElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLLIElement>) => void;
  readonly onWheel: (event: ReactWheelEvent<HTMLLIElement>) => void;
}

function place(toast: HTMLLIElement, offset: number): void {
  toast.style.setProperty("--ui-toast-drag", `${offset}px`);
}

function farEnough(toast: HTMLLIElement, offset: number): boolean {
  return Math.abs(offset) >= Math.max(SWIPE_LEAST, toast.offsetWidth * SWIPE_AWAY);
}

function springHome(toast: HTMLLIElement, offset: number, delay: number): Animation | undefined {
  place(toast, 0);
  const timing = tokenTiming(toast, MOTION_TOKEN.DURATION_FAST, MOTION_TOKEN.SPRING_FAST);
  if (offset === 0 || typeof toast.animate !== "function") return undefined;
  if (timing === undefined && delay === 0) return undefined;
  return toast.animate([{ translate: `${offset}px 0` }, { translate: "0 0" }], {
    ...(timing ?? HELD),
    delay,
    fill: "backwards",
  });
}

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
        if (Math.abs(dx) < SWIPE_SLOP && Math.abs(event.clientY - held.y) < SWIPE_SLOP) return;
        if (Math.abs(dx) < Math.abs(event.clientY - held.y)) {
          press.current = undefined;
          return;
        }
        held.dragging = true;
        home.current?.cancel();
        toast.dataset.dragging = "true";
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
