import { type RefObject, useEffect, useRef } from "react";

const PAGE_SWIPE = {
  SLOP: 8,
  LEAN: 1.5,
  WALK_SHARE: 0.25,
  PROJECT_MS: 160,
  SPEED_WINDOW_MS: 80,
} as const;

const SWIPE_ATTRIBUTE = "data-ui-page-swipe";
const OFFSET_PROPERTY = "--ui-page-swipe-offset";

const DRAGGED_ITSELF = 'input, textarea, [role="slider"], [data-slot="slider"]';

const SCROLLING_OVERFLOW = new Set(["auto", "scroll"]);

const SWIPE_STATE = {
  WAITING: "waiting",
  CLAIMED: "claimed",
} as const;

type SwipeState = (typeof SWIPE_STATE)[keyof typeof SWIPE_STATE];

interface Sample {
  readonly at: number;
  readonly offset: number;
}

interface Swipe {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  state: SwipeState;
  readonly samples: Sample[];
}

export interface PageSwipeOptions {
  readonly enabled: boolean;
  readonly surface: RefObject<HTMLElement | null>;
  readonly onStep: (step: 1 | -1) => void;
}

function speed(samples: readonly Sample[]): number {
  const last = samples.at(-1);
  if (last === undefined) return 0;
  const first = samples.find((sample) => last.at - sample.at <= PAGE_SWIPE.SPEED_WINDOW_MS);
  if (first === undefined || last.at === first.at) return 0;
  return (last.offset - first.offset) / (last.at - first.at);
}

function stepOnRelease(offset: number, velocity: number, width: number): 1 | -1 | undefined {
  const landed = offset + velocity * PAGE_SWIPE.PROJECT_MS;
  if (Math.abs(landed) <= width * PAGE_SWIPE.WALK_SHARE) return undefined;
  return landed < 0 ? 1 : -1;
}

function keepsFinger(target: Element, surface: HTMLElement): boolean {
  for (let box: Element | null = target; box !== null && box !== surface; box = box.parentElement) {
    if (box.matches(DRAGGED_ITSELF)) return true;
    if (box.scrollWidth <= box.clientWidth) continue;
    if (SCROLLING_OVERFLOW.has(getComputedStyle(box).overflowX)) return true;
  }
  return false;
}

export function usePageSwipe(options: PageSwipeOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const swipe = useRef<Swipe | undefined>(undefined);
  const swiped = useRef(false);
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
      swiped.current = false;
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
      const sideways = Math.abs(touch.clientX - held.x) >= Math.abs(touch.clientY - held.y);
      if (held.state === SWIPE_STATE.CLAIMED || sideways) event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      const held = swipe.current;
      if (held === undefined || held.pointerId !== event.pointerId) return;
      drop();
      if (held.state !== SWIPE_STATE.CLAIMED) return;
      swiped.current = true;
      if (event.type !== "pointerup") return;
      const offset = event.clientX - held.x;
      held.samples.push({ at: event.timeStamp, offset });
      const step = stepOnRelease(offset, speed(held.samples), held.width);
      if (step !== undefined) latest.current.onStep(step);
    };
    const click = (event: MouseEvent) => {
      if (!swiped.current || event.detail === 0) return;
      swiped.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const capture = { capture: true } as const;
    window.addEventListener("pointerdown", down, capture);
    window.addEventListener("pointermove", move, capture);
    window.addEventListener("pointerup", up, capture);
    window.addEventListener("pointercancel", up, capture);
    window.addEventListener("click", click, capture);
    window.addEventListener("touchmove", touchMove, { capture: true, passive: false });
    return () => {
      window.removeEventListener("pointerdown", down, capture);
      window.removeEventListener("pointermove", move, capture);
      window.removeEventListener("pointerup", up, capture);
      window.removeEventListener("pointercancel", up, capture);
      window.removeEventListener("click", click, capture);
      window.removeEventListener("touchmove", touchMove, capture);
      drop();
    };
  }, [enabled, surface]);
}
