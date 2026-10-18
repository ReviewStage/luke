import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * use-row-swipe.ts -- a row swiped right to its one act, in two stages, as a mail app's thread is: a short swipe leaves it resting open on the act's button, a long one does the act on release.
 *
 * A press on the row is a click until the pointer has gone a few pixels;
 * gone further sideways than up or down, it is a swipe, the pointer
 * captured by the row's item, and the row follows it to the right, never
 * left of where it rests. A two-finger swipe on a trackpad moves it the
 * same way, by its horizontal wheel deltas, once the movement leans
 * sideways: 5px, and twice as far as up or down. A movement that begins up
 * or down is the list's to scroll until its wheel rests, however it turns,
 * so a scroll never swipes a row. The trackpad's swipe is let go once its
 * deltas shrink five times running, as a coast's do once the fingers lift,
 * or else once the wheel rests; the coast after moves nothing.
 *
 * The row follows the hand with no render, its place written straight onto
 * the item, and past `SWIPE.GIVE_SHARE` of the row it gives, keeping a
 * third of the hand's travel. Let go past `SWIPE.OPEN`, the row rests open
 * on the act's button, which a click presses; let go past `SWIPE.ACT_SHARE`
 * of the row, the act is done with no click, and while the row stands past
 * that line it is armed, the button brighter and its label riding the
 * row's edge a beat behind. Where a release lands is carried along the
 * hand's speed, so a flick right acts or opens and one back closes. Let go
 * short of both, it closes. A press anywhere but the open row, a wheel
 * elsewhere, a click on the row itself, or swiping it back closes it.
 * Swiping left from rest does nothing.
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
  /** How far a press or a trackpad goes sideways before it is a swipe rather than a click or a scroll. */
  START: 5,
  /** How much more sideways than up or down a trackpad's first movement must be to begin a swipe. */
  LEAN: 2,
  /** Past this, a release leaves the row resting open on the act's button. */
  OPEN: 24,
  /** Where an open row rests: the button's width. */
  REST: 72,
  /** Past this share of the row's width, a release does the act. */
  ACT_SHARE: 0.6,
  /** Past this share of the row's width, the row goes on with a third of the hand's travel, as a held edge gives. */
  GIVE_SHARE: 0.85,
  /** How much of the hand's travel the row keeps past the give. */
  GIVE: 0.35,
  /** How far ahead a release looks along the hand's speed, in milliseconds, so a flick carries. */
  PROJECT_MS: 120,
  /** The most a flick carries a release, either way. */
  PROJECT_MAX: 64,
  /** How far back the hand's speed is read, in milliseconds. */
  SPEED_WINDOW_MS: 80,
  /** The shortest span the speed is read over, in milliseconds; a shorter one says nothing. */
  SPEED_MIN_MS: 8,
  /** How many shrinking wheel deltas in a row mean the fingers have lifted and the trackpad coasts. */
  COAST: 5,
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
  /** Where the hand was lately, for its speed at release. */
  readonly samples: Sample[];
}

/** Where the hand put the row, and when, by the event's own clock. */
interface Sample {
  readonly at: number;
  readonly offset: number;
}

/**
 * A trackpad's movement under way, read by its wheel. Before it is a swipe
 * it leans one way or the other: sideways enough, it begins one; up or down
 * first, it is the list's to scroll until the wheel rests. Once the deltas
 * shrink steadily the fingers have lifted and the trackpad coasts, so the
 * swipe is let go then and the rest of the coast moves nothing.
 */
interface Wheel {
  /** The act a swipe began on; none while the movement leans no way yet, or is a scroll. */
  act: string | undefined;
  /** Whether the movement is the list's to scroll. */
  scroll: boolean;
  /** Whether the fingers lifted and the swipe was let go, the coast left to run out. */
  coasting: boolean;
  /** How far the movement has gone each way before it leaned. */
  leanX: number;
  leanY: number;
  /** Where the row stood as the swipe began, and how far right the hand has gone since, before any give. */
  from: number;
  travel: number;
  /** The last delta's size, and how many deltas in a row have shrunk. */
  last: number;
  shrinking: number;
  readonly samples: Sample[];
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

/** Where the row stands for the hand's travel: as far as the hand, never left of rest, and giving past `SWIPE.GIVE_SHARE` of the row. */
function followed(travel: number, width: number): number {
  const at = Math.max(0, travel);
  const give = width * SWIPE.GIVE_SHARE;
  return width > 0 && at > give ? give + (at - give) * SWIPE.GIVE : at;
}

/** A sample kept, and those older than the speed's window dropped. */
function sampled(samples: Sample[], sample: Sample): void {
  samples.push(sample);
  while (samples.length > 2 && sample.at - (samples[0]?.at ?? sample.at) > SWIPE.SPEED_WINDOW_MS) {
    samples.shift();
  }
}

/**
 * Where a release lands once the hand's speed carries it: the row's own
 * place, moved along the speed for `SWIPE.PROJECT_MS` and by no more than
 * `SWIPE.PROJECT_MAX`, so a flick right acts or opens sooner and one back
 * closes. Samples over too short a span say no speed.
 */
function projected(offset: number, samples: readonly Sample[]): number {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) return offset;
  const span = last.at - first.at;
  if (span < SWIPE.SPEED_MIN_MS) return offset;
  const carry = ((last.offset - first.offset) / span) * SWIPE.PROJECT_MS;
  return offset + Math.max(-SWIPE.PROJECT_MAX, Math.min(SWIPE.PROJECT_MAX, carry));
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
  const [armedDrawn, setArmedDrawn] = useState(false);
  // Note that the offset and the row's width are held in refs too, so a release reads them as the last move left them rather than as the last render drew them.
  const at = useRef(0);
  const width = useRef(0);
  const moving = useRef(false);
  /** Where the row is put at rest, open, or home: drawn by a render, as the row settles on the stylesheet's timing. */
  const setOffset = (next: number) => {
    at.current = next;
    moving.current = false;
    setOffsetDrawn(next);
    setArmedDrawn(false);
  };
  /**
   * Where the row follows the hand: written straight onto the item, so a
   * move costs no render and the row keeps up with a trackpad's every
   * frame; a render comes only as the row arms or disarms.
   */
  const follow = (next: number) => {
    at.current = next;
    moving.current = true;
    const armed = acts(next, width.current);
    const item = ref.current;
    if (item !== null) {
      const label = labelAt(next, armed);
      item.style.setProperty("--luke-list-row-swipe", `${next}px`);
      item.style.setProperty("--luke-list-row-swipe-label", `${label.offset}px`);
      item.style.setProperty("--luke-list-row-swipe-shown", String(label.opacity));
    }
    setArmedDrawn(armed);
  };
  // Note that a row put down by a render is put there whatever the hand last wrote, since a render that draws the same place as the one before writes nothing.
  useLayoutEffect(() => {
    const item = ref.current;
    if (item === null || moving.current) return;
    const label = labelAt(offset, false);
    item.style.setProperty("--luke-list-row-swipe", `${offset}px`);
    item.style.setProperty("--luke-list-row-swipe-label", `${label.offset}px`);
    item.style.setProperty("--luke-list-row-swipe-shown", String(label.opacity));
  });
  const press = useRef<Press | undefined>(undefined);
  const wheel = useRef<Wheel | undefined>(undefined);
  const swallow = useRef(false);
  /** The act the row was left open on. */
  const openedOn = useRef<string | undefined>(undefined);
  const latest = useRef({ act, onAct });
  useLayoutEffect(() => {
    latest.current = { act, onAct };
  });

  // Note that closing lets go of a trackpad's movement still waiting for its wheel to rest, so its frame can never settle it after,
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
  // Note that the act's own words are read at release, so a row the list redrew with another act does nothing;
  // and that where the release lands is carried by the hand's speed, so a flick acts or closes as it was thrown.
  const settle = (began: string, samples: readonly Sample[]) => {
    if (latest.current.act !== began) return close();
    const landed = projected(at.current, samples);
    if (acts(landed, width.current)) {
      latest.current.onAct();
      return close();
    }
    if (landed >= SWIPE.OPEN) {
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
  // A row the list drops takes its wheel's movement with it.
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
    // A movement that leaned no way, was the list's, or coasted after its swipe was let go, rests with nothing to settle.
    if (held.act === undefined || held.scroll || held.coasting) return;
    settle(held.act, held.samples);
  };
  const wheelMoved = (event: WheelEvent) => {
    const current = latest.current.act;
    if (current === undefined || press.current !== undefined) return;
    let held = wheel.current;
    if (held === undefined) {
      held = {
        act: undefined,
        scroll: false,
        coasting: false,
        leanX: 0,
        leanY: 0,
        from: 0,
        travel: 0,
        last: 0,
        shrinking: 0,
        samples: [],
        movedAt: undefined,
        frame: requestAnimationFrame(wheelFrame),
      };
      wheel.current = held;
    }
    // A wheel more up or down than sideways during a swipe is the list's to scroll, and leaves the swipe's rest uncounted;
    // it ends the swipe's flick, so a scroll after a quick swipe never carries the row on to act.
    if (held.act !== undefined && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
      held.samples.length = 0;
      return;
    }
    held.movedAt = undefined;
    // A movement that began up or down is the list's to scroll until its wheel rests, however it turns.
    if (held.scroll) return;
    if (held.act === undefined) {
      held.leanX += event.deltaX;
      held.leanY += event.deltaY;
      const sideways = Math.abs(held.leanX);
      const upright = Math.abs(held.leanY);
      if (upright > sideways) {
        held.scroll = true;
        return;
      }
      if (sideways < SWIPE.START || sideways < upright * SWIPE.LEAN) return;
      event.preventDefault();
      measure();
      held.act = current;
      // Note that a swipe begun on an open row starts from where it rests, and the give is read off the hand's whole travel, never off a place it already gave.
      held.from = at.current;
      held.travel = -held.leanX;
      setState(SWIPE_STATE.MOVING);
      held.last = Math.abs(event.deltaX);
      follow(followed(held.from + held.travel, width.current));
      sampled(held.samples, { at: event.timeStamp, offset: at.current });
      return;
    }
    event.preventDefault();
    if (held.coasting) return;
    // Note that a coast's deltas shrink smoothly, one after another, as a hand's never do for long, so a run of them is the fingers lifted.
    const size = Math.abs(event.deltaX);
    held.shrinking = size > 0 && size < held.last ? held.shrinking + 1 : 0;
    held.last = size;
    held.travel -= event.deltaX;
    follow(followed(held.from + held.travel, width.current));
    sampled(held.samples, { at: event.timeStamp, offset: at.current });
    if (held.shrinking >= SWIPE.COAST) {
      held.coasting = true;
      settle(held.act, held.samples);
      // Note that settling may close the row, letting go of the movement; the coast is still the hand's, so it is held until the wheel rests and moves nothing.
      if (wheel.current === undefined) {
        held.movedAt = undefined;
        held.frame = requestAnimationFrame(wheelFrame);
        wheel.current = held;
      }
    }
  };
  useLayoutEffect(() => {
    heard.current = wheelMoved;
  });

  const view: RowSwipeView = (() => {
    // Note that a render while the row follows the hand draws where the hand left it, not where the last render did.
    const drawn = moving.current ? at.current : offset;
    const armed = state === SWIPE_STATE.MOVING && armedDrawn;
    return { state, offset: drawn, armed, label: labelAt(drawn, armed) };
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
          samples: [],
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
        follow(followed(held.from + dx, width.current));
        sampled(held.samples, { at: event.timeStamp, offset: at.current });
      },
      onPointerUp: (event) => {
        const held = press.current;
        if (held === undefined || held.pointerId !== event.pointerId) return;
        press.current = undefined;
        if (held.swiping) {
          swallow.current = true;
          follow(followed(held.from + event.clientX - held.x, width.current));
          sampled(held.samples, { at: event.timeStamp, offset: at.current });
          settle(held.act, held.samples);
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
        // Note that only a pointer's click is a swipe's to swallow; a click the keyboard makes, which no press came before, always lands.
        if (event.detail === 0) return;
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
