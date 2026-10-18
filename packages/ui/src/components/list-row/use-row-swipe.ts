import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * use-row-swipe.ts -- a row swiped right to its one act, in two stages, as a mail app's thread is: a short swipe leaves it resting open on the act's button, a long one does the act on release.
 *
 * A press on the row is a click until the pointer has gone a few pixels;
 * gone further sideways than up or down, it is a swipe, the pointer
 * captured by the row's item, and the row follows it to the right, never
 * left of where it rests. A two-finger swipe on a trackpad moves it the
 * same way, by its horizontal wheel deltas, and is let go once they stop.
 * Let go past `SWIPE.OPEN`, the row rests open on the act's button, which a
 * click presses; let go past `SWIPE.ACT_SHARE` of the row, the act is done
 * with no click, and while the row stands past that line it is armed, the
 * button brighter and its label riding the row's edge. Let go short of
 * both, it closes. A press anywhere but the open row, a wheel elsewhere, a
 * click on the row itself, or swiping it back closes it. Swiping left from
 * rest does nothing.
 *
 * A pointer the system took away never acts, and nor does a swipe whose
 * act changed under it, since the list redrew the row with something else
 * to do than what the reader saw; a row the list dropped takes its swipe
 * with it. The click a captured pointer's release makes is swallowed, so a
 * swipe opens nothing. The row moves on its `transform` alone, as the
 * stylesheet times it from the motion tokens, so reduced motion and a
 * capture run hold its settling still.
 */

/** The swipe's lengths, in CSS pixels, and the share of the row past which a release acts. */
const SWIPE = {
  /** How far a press goes before it is a swipe rather than a click. */
  START: 5,
  /** Past this, a release leaves the row resting open on the act's button. */
  OPEN: 24,
  /** Where an open row rests: the button's width. */
  REST: 72,
  /** Past this share of the row's width, a release does the act. */
  ACT_SHARE: 0.6,
  /** The width of the act's label inside its button. */
  LABEL: 56,
  /** How far inside the row's edge an armed label rides. */
  LABEL_INSET: 8,
  /** How long a trackpad's wheel stays still, in milliseconds, before its swipe is let go. */
  WHEEL_REST_MS: 140,
} as const;

/** Where a swiped row stands. */
const SWIPE_STATE = {
  REST: "rest",
  /** Following the pointer or the wheel. */
  MOVING: "moving",
  OPEN: "open",
} as const;

type SwipeState = (typeof SWIPE_STATE)[keyof typeof SWIPE_STATE];

/** What the row draws: where it stands, how far it is out, whether a release would act, and where the act's label stands. */
interface RowSwipeView {
  readonly state: SwipeState;
  readonly offset: number;
  readonly armed: boolean;
  readonly label: { readonly offset: number; readonly opacity: number };
}

/** What the hook hands the row's item and its act's button. */
interface RowSwipe {
  readonly view: RowSwipeView;
  readonly item: {
    readonly ref: React.RefObject<HTMLLIElement | null>;
    readonly onPointerDown: (event: React.PointerEvent<HTMLLIElement>) => void;
    readonly onPointerMove: (event: React.PointerEvent<HTMLLIElement>) => void;
    readonly onPointerUp: (event: React.PointerEvent<HTMLLIElement>) => void;
    readonly onPointerCancel: (event: React.PointerEvent<HTMLLIElement>) => void;
    readonly onClickCapture: (event: React.MouseEvent<HTMLLIElement>) => void;
  };
  /** The open row's button pressed: the act, and the row closed. */
  readonly onPress: () => void;
}

/** A press under way: where it began, where the row stood, the act it began on, and whether it is a swipe yet. */
interface Press {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly from: number;
  readonly act: string;
  swiping: boolean;
}

/** A trackpad swipe under way: the act it began on, and the frame time its wheel last moved at, unknown until the next frame. */
interface Wheel {
  readonly act: string;
  movedAt: number | undefined;
  frame: number;
}

/** What a press lands on that is a control of its own rather than the row's face: the act's button, or one of the row's acts. */
const ROW_CONTROLS = "[data-swipe-act], .luke-list-row-actions";

/** Whether a release at `offset` on a row `width` wide acts. */
function acts(offset: number, width: number): boolean {
  return width > 0 && offset >= width * SWIPE.ACT_SHARE;
}

/** Where the act's label stands: centred in the button while it shows, riding the row's edge once armed; and how much of it shows. */
function labelAt(offset: number, armed: boolean): RowSwipeView["label"] {
  return {
    offset: armed
      ? offset - SWIPE.LABEL - SWIPE.LABEL_INSET
      : (Math.min(offset, SWIPE.REST) - SWIPE.LABEL) / 2,
    opacity: Math.min(1, offset / SWIPE.REST),
  };
}

/**
 * A row swiped to its one act. `act` names what the act does now, its
 * label, so a swipe whose act changed before its release does nothing;
 * none where the row offers no swipe, which leaves every press a click.
 */
export function useRowSwipe(act: string | undefined, onAct: () => void): RowSwipe {
  const ref = useRef<HTMLLIElement | null>(null);
  const [state, setState] = useState<SwipeState>(SWIPE_STATE.REST);
  const [offset, setOffsetDrawn] = useState(0);
  // Note that the offset and the row's width are held in refs too, so a release reads them as the last move left them rather than as the last render drew them.
  const at = useRef(0);
  const width = useRef(0);
  const setOffset = (next: number) => {
    at.current = next;
    setOffsetDrawn(next);
  };
  const press = useRef<Press | undefined>(undefined);
  const wheel = useRef<Wheel | undefined>(undefined);
  const swallow = useRef(false);
  /** The act the row was left open on. */
  const openedOn = useRef<string | undefined>(undefined);
  const latest = useRef({ act, onAct });
  useLayoutEffect(() => {
    latest.current = { act, onAct };
  });

  // Note that closing lets go of a trackpad's swipe still waiting for its wheel to rest, so its frame can never settle it after,
  // and of a pointer's swipe still held, so its release does nothing and its click opens nothing.
  const close = () => {
    if (wheel.current !== undefined) cancelAnimationFrame(wheel.current.frame);
    wheel.current = undefined;
    const held = press.current;
    press.current = undefined;
    if (held?.swiping === true) {
      swallow.current = true;
      if (ref.current?.hasPointerCapture?.(held.pointerId) === true) {
        ref.current.releasePointerCapture(held.pointerId);
      }
    }
    setOffset(0);
    setState(SWIPE_STATE.REST);
  };
  // Note that the act's own words are read at release, so a row the list redrew with another act does nothing.
  const settle = (began: string) => {
    if (latest.current.act !== began) return close();
    if (acts(at.current, width.current)) {
      latest.current.onAct();
      return close();
    }
    if (at.current >= SWIPE.OPEN) {
      openedOn.current = began;
      setOffset(SWIPE.REST);
      setState(SWIPE_STATE.OPEN);
      return;
    }
    close();
  };
  const measure = () => {
    width.current = ref.current?.getBoundingClientRect().width ?? 0;
  };

  // A row open, or out on a trackpad's swipe, closes on a press or a wheel anywhere else, as another row's swipe begins.
  const open = state === SWIPE_STATE.OPEN;
  const out = state !== SWIPE_STATE.REST;
  useEffect(() => {
    if (!out) return;
    const elsewhere = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", elsewhere, true);
    document.addEventListener("wheel", elsewhere, true);
    return () => {
      document.removeEventListener("pointerdown", elsewhere, true);
      document.removeEventListener("wheel", elsewhere, true);
    };
  }, [out]);
  // An open row whose act changed under it closes, so its button never offers what the row no longer does.
  useEffect(() => {
    if (open && openedOn.current !== act) close();
  });
  // The wheel's swipe is heard on the item itself, not passively, so a sideways swipe does not scroll the list too.
  const offered = act !== undefined;
  const heard = useRef<(event: WheelEvent) => void>(() => undefined);
  useEffect(() => {
    const item = ref.current;
    if (item === null || !offered) return;
    const listen = (event: WheelEvent) => heard.current(event);
    item.addEventListener("wheel", listen, { passive: false });
    return () => item.removeEventListener("wheel", listen);
  }, [offered]);
  // A row the list drops takes its wheel's swipe with it.
  useEffect(
    () => () => {
      if (wheel.current !== undefined) cancelAnimationFrame(wheel.current.frame);
    },
    [],
  );

  // Note that the wheel's rest is timed on the frames' own clock, a frame after the last delta standing for when it moved, so it reads one clock throughout.
  const wheelFrame = (time: number) => {
    const held = wheel.current;
    if (held === undefined) return;
    if (held.movedAt === undefined) held.movedAt = time;
    if (time - held.movedAt < SWIPE.WHEEL_REST_MS) {
      held.frame = requestAnimationFrame(wheelFrame);
      return;
    }
    wheel.current = undefined;
    settle(held.act);
  };
  const wheelMoved = (event: WheelEvent) => {
    const current = latest.current.act;
    if (current === undefined || press.current !== undefined) return;
    // A wheel more up or down than sideways is the list's to scroll, a swipe under way or not, and leaves the swipe's rest uncounted.
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    if (wheel.current === undefined) {
      measure();
      wheel.current = {
        act: current,
        movedAt: undefined,
        frame: requestAnimationFrame(wheelFrame),
      };
      setState(SWIPE_STATE.MOVING);
    }
    wheel.current.movedAt = undefined;
    setOffset(Math.max(0, at.current - event.deltaX));
  };
  useLayoutEffect(() => {
    heard.current = wheelMoved;
  });

  const view: RowSwipeView = (() => {
    const armed = state === SWIPE_STATE.MOVING && acts(offset, width.current);
    return { state, offset, armed, label: labelAt(offset, armed) };
  })();

  return {
    view,
    item: {
      ref,
      onPointerDown: (event) => {
        swallow.current = false;
        // A press interrupts a trackpad's swipe, which then does nothing.
        if (wheel.current !== undefined) close();
        const current = latest.current.act;
        if (current === undefined || event.button !== 0) return;
        // Note that a press on the act's button or on the row's own acts is theirs, never a swipe's, so an open row's acts still take their click.
        if (event.target instanceof Element && event.target.closest(ROW_CONTROLS) !== null) return;
        press.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          from: at.current,
          act: current,
          swiping: false,
        };
      },
      onPointerMove: (event) => {
        const held = press.current;
        if (held === undefined || held.pointerId !== event.pointerId) return;
        const dx = event.clientX - held.x;
        const dy = event.clientY - held.y;
        if (!held.swiping) {
          if (Math.abs(dx) < SWIPE.START && Math.abs(dy) < SWIPE.START) return;
          // A press that goes up or down more than sideways is the list's to scroll, never a swipe.
          if (Math.abs(dy) > Math.abs(dx)) {
            press.current = undefined;
            return;
          }
          held.swiping = true;
          measure();
          ref.current?.setPointerCapture?.(event.pointerId);
          setState(SWIPE_STATE.MOVING);
        }
        setOffset(Math.max(0, held.from + dx));
      },
      onPointerUp: (event) => {
        const held = press.current;
        if (held === undefined || held.pointerId !== event.pointerId) return;
        press.current = undefined;
        if (held.swiping) {
          swallow.current = true;
          setOffset(Math.max(0, held.from + event.clientX - held.x));
          settle(held.act);
          return;
        }
        // A click on an open row closes it and opens nothing.
        if (held.from > 0) {
          swallow.current = true;
          close();
        }
      },
      onPointerCancel: (event) => {
        if (press.current?.pointerId !== event.pointerId) return;
        const swiping = press.current.swiping;
        press.current = undefined;
        if (swiping) close();
      },
      onClickCapture: (event) => {
        if (!swallow.current) return;
        swallow.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    },
    onPress: () => {
      if (latest.current.act === undefined) return;
      latest.current.onAct();
      close();
    },
  };
}
