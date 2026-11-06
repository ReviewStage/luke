import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

const DRAWER_SWIPE = {
  EDGE_MARGIN: 20,
  EDGE_REACH: 44,
  SLOP: 6,
  LEAN: 1.5,
  OPEN_SHARE: 0.5,
  PROJECT_MS: 160,
  SPEED_WINDOW_MS: 80,
} as const;

const DRAG_ATTRIBUTE = "data-ui-drawer-drag";
const PROGRESS_PROPERTY = "--ui-drawer-progress";

const SWIPE_STATE = {
  WAITING: "waiting",
  CLAIMED: "claimed",
} as const;

type SwipeState = (typeof SWIPE_STATE)[keyof typeof SWIPE_STATE];

interface Sample {
  readonly at: number;
  readonly progress: number;
}

interface Swipe {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly from: number;
  readonly width: number;
  state: SwipeState;
  readonly samples: Sample[];
}

export interface DrawerSwipeOptions {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly stage: RefObject<HTMLElement | null>;
  readonly drawer: () => HTMLElement | null;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

function clampShare(share: number): number {
  return Math.min(1, Math.max(0, share));
}

function speed(samples: readonly Sample[]): number {
  const last = samples.at(-1);
  if (last === undefined) return 0;
  const first = samples.find((sample) => last.at - sample.at <= DRAWER_SWIPE.SPEED_WINDOW_MS);
  if (first === undefined || last.at === first.at) return 0;
  return (last.progress - first.progress) / (last.at - first.at);
}

function opensOnRelease(progress: number, velocity: number): boolean {
  return progress + velocity * DRAWER_SWIPE.PROJECT_MS > DRAWER_SWIPE.OPEN_SHARE;
}

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

export function useDrawerSwipe(options: DrawerSwipeOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const swipe = useRef<Swipe | undefined>(undefined);
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
      const sideways = Math.abs(touch.clientX - held.x) >= Math.abs(touch.clientY - held.y);
      if (held.state === SWIPE_STATE.CLAIMED || sideways) event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      const held = swipe.current;
      if (held === undefined || held.pointerId !== event.pointerId) return;
      swipe.current = undefined;
      if (held.state !== SWIPE_STATE.CLAIMED) return;
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
