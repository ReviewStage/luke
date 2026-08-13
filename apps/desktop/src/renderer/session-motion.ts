import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * How the session list moves when its order changes under a reader.
 *
 * Every poll re-sorts the rows, and React answers a new order by moving DOM
 * nodes — which repaints each row at its new position in one frame. A session
 * finishing its turn would teleport from the top of the list to the middle,
 * and the reader loses it. So the list is measured on every commit, and a row
 * found somewhere new is started back where the reader last saw it and
 * released — on `--spring-fast`, because a row hopping a slot is a small
 * element moving, not the surface resizing.
 *
 * Reorders come and go on the panel's own two-beat rule: content leaves before
 * the shape moves, and the shape moves before content arrives. A departing row
 * fades over `--duration-exit` while it still holds its slot (the roster below
 * keeps it rendered exactly that long), and only then do its neighbours close
 * the gap. An arriving row opens its gap first — it is measured, so the
 * neighbours travel at once — and only fades in after that same beat, so it is
 * never seen crossing a row that has not yet left its slot.
 *
 * Each travel is additive rather than a replacement. A second reorder landing
 * mid-flight does not cancel the first — cancelling is a dead stop and a
 * re-acceleration, which is exactly the snap this module exists to remove — it
 * adds its own delta on top, and the two decay together into the new resting
 * place. That also keeps the bookkeeping honest: no animation is ever tracked,
 * cancelled, or corrected for, because every one of them ends at zero.
 *
 * The distances, durations, and springs are read from the motion tokens rather
 * than carried here, so a capture run (which zeroes them) and reduced motion
 * (which collapses them to a millisecond) both silence this motion without
 * knowing it exists.
 */

/**
 * How each row names its session to the measurement pass. An attribute rather
 * than a React ref, so the list can be read in document order in one query and
 * the rows need no plumbing beyond carrying their own id.
 */
export const SESSION_ROW_ID_ATTRIBUTE = "data-session-id";

/**
 * How a row says it is on its way out. The fade it announces is drawn here
 * rather than in the stylesheet, because the row's own opacity transition
 * carries the panel-arrival stagger: a session that returned mid-fade would
 * wait out `--expand-delay` before resuming. An animation never touches the
 * property underneath, so cancelling it is all a return takes — the row is
 * simply alive again, at once.
 */
export const SESSION_ROW_LEAVING_ATTRIBUTE = "data-leaving";

const MOTION_TOKEN = {
  SPRING_FAST: "--spring-fast",
  FAST_DURATION: "--duration-fast",
  EXIT_DURATION: "--duration-exit",
  EXIT_EASING: "--motion-exit",
  QUICK_DURATION: "--duration-quick",
  ROW_FAN: "--row-fan",
} as const;

type MotionToken = (typeof MOTION_TOKEN)[keyof typeof MOTION_TOKEN];

/** Movement smaller than a hairline is measurement noise, not a reorder. */
const TRAVEL_EPSILON = 0.5;

/**
 * Below this, a duration is a request for stillness rather than for very fast
 * motion: capture zeroes the tokens outright and reduced motion leaves 1ms so
 * transitions still fire their end events. Neither wants an animation started.
 */
const STILL_MS = 2;

/** "460ms" or "0.46s" from a computed token, taken as milliseconds. */
export function parseMilliseconds(value: string): number {
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (Number.isNaN(parsed)) return 0;
  return trimmed.endsWith("ms") ? parsed : parsed * 1000;
}

/** "7px" from a computed token, taken as pixels. */
export function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export interface ReorderPlan {
  /**
   * Rows that persisted and moved: how far each must be offset, in pixels, to
   * appear back where it was before springing to where it now sits.
   */
  travels: ReadonlyMap<string, number>;
  /** Rows with no previous position: they arrived rather than moved. */
  arrivals: readonly string[];
}

const EMPTY_PLAN: ReorderPlan = { travels: new Map(), arrivals: [] };

/**
 * What moved, given where each row was and where it now is. With no baseline
 * at all — the first measurement of a freshly built list — nothing "moved" and
 * nothing "arrived"; the list simply is, and animating it would replay an
 * entrance the panel's own arrival already owns. A baseline of an empty list
 * is different: a session appearing in one the reader is watching is an event.
 * Rows that left are not planned for — their exit is the roster's beat, and by
 * the time they leave this measurement their nodes are already gone.
 */
export function planReorder(
  previous: ReadonlyMap<string, number> | undefined,
  next: ReadonlyMap<string, number>,
): ReorderPlan {
  if (previous === undefined) return EMPTY_PLAN;

  const travels = new Map<string, number>();
  const arrivals: string[] = [];
  for (const [id, top] of next) {
    const before = previous.get(id);
    if (before === undefined) {
      arrivals.push(id);
      continue;
    }
    const travel = before - top;
    if (Math.abs(travel) > TRAVEL_EPSILON) travels.set(id, travel);
  }
  return { travels, arrivals };
}

/** Only rows a reader can see are worth moving; hidden ones just take their place. */
function rowVisible(row: HTMLElement): boolean {
  return row.checkVisibility({ opacityProperty: true });
}

/**
 * Watches the session list across commits and turns every reorder into motion.
 * Returns the ref the list container must carry; a commit that unmounts the
 * container (the settings tab, the slot) drops the baseline, so the next list
 * built starts still instead of animating against positions from another life.
 */
export function useSessionReorderMotion(): RefObject<HTMLDivElement | null> {
  const listRef = useRef<HTMLDivElement | null>(null);
  const baseline = useRef<Map<string, number> | undefined>(undefined);
  const wasLeaving = useRef<Set<string>>(new Set());
  const exitFades = useRef<Map<string, Animation>>(new Map());

  // No dependency list: a reorder arrives as new props, but the measurement
  // has to follow every commit that could have moved a row, and a handful of
  // offset reads per commit costs less than proving which commits those are.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) {
      baseline.current = undefined;
      wasLeaving.current = new Set();
      exitFades.current.clear();
      return;
    }

    const rows = new Map<string, HTMLElement>();
    // `offsetTop` rather than a rect: it is the row's layout position, blind
    // to both the scroll and every animation still in flight, so the baseline
    // never needs correcting for either.
    const tops = new Map<string, number>();
    for (const row of list.querySelectorAll<HTMLElement>(`[${SESSION_ROW_ID_ATTRIBUTE}]`)) {
      const id = row.getAttribute(SESSION_ROW_ID_ATTRIBUTE);
      if (id === null) continue;
      rows.set(id, row);
      tops.set(id, row.offsetTop);
    }

    // Rows whose leaving mark changed this commit: the newly departed begin
    // their fade, and the returned have theirs cancelled. A fade belonging to
    // a row no longer drawn died with its node and is only forgotten here.
    const departed: [string, HTMLElement][] = [];
    const returned: [string, HTMLElement][] = [];
    const leaving = new Set<string>();
    for (const [id, row] of rows) {
      if (row.getAttribute(SESSION_ROW_LEAVING_ATTRIBUTE) === "true") leaving.add(id);
      const was = wasLeaving.current.has(id);
      if (!was && leaving.has(id)) departed.push([id, row]);
      else if (was && !leaving.has(id)) returned.push([id, row]);
    }
    wasLeaving.current = leaving;
    for (const id of [...exitFades.current.keys()]) {
      if (!rows.has(id)) exitFades.current.delete(id);
    }

    const plan = planReorder(baseline.current, tops);
    baseline.current = tops;
    if (
      plan.travels.size === 0 &&
      plan.arrivals.length === 0 &&
      departed.length === 0 &&
      returned.length === 0
    ) {
      return;
    }

    const style = getComputedStyle(list);
    const token = (name: MotionToken) => style.getPropertyValue(name);
    const fastDuration = parseMilliseconds(token(MOTION_TOKEN.FAST_DURATION));
    if (fastDuration < STILL_MS) return;
    const springFast = token(MOTION_TOKEN.SPRING_FAST).trim() || "ease";
    const exitDuration = parseMilliseconds(token(MOTION_TOKEN.EXIT_DURATION));
    const quickDuration = parseMilliseconds(token(MOTION_TOKEN.QUICK_DURATION));
    const exitEasing = token(MOTION_TOKEN.EXIT_EASING).trim() || "ease";
    const fan = parsePixels(token(MOTION_TOKEN.ROW_FAN));

    const travel = (row: HTMLElement, from: number, delay: number) => {
      row.animate([{ transform: `translateY(${from}px)` }, { transform: "translateY(0px)" }], {
        duration: fastDuration,
        easing: springFast,
        delay,
        fill: "backwards",
        composite: "add",
      });
    };

    // A malformed token would throw out of `animate` and take the whole tree
    // down with the layout effect; the rows arriving in place is the better
    // failure.
    try {
      for (const [id, row] of departed) {
        if (!rowVisible(row) || exitDuration < STILL_MS) continue;
        exitFades.current.set(
          id,
          // From wherever the row's opacity is, held at nothing until the
          // roster lets the node go: the fade must outlive its own end,
          // because the property underneath still says the row is drawn.
          row.animate([{ opacity: getComputedStyle(row).opacity }, { opacity: 0 }], {
            duration: exitDuration,
            easing: exitEasing,
            fill: "forwards",
          }),
        );
      }
      for (const [id, row] of returned) {
        const fade = exitFades.current.get(id);
        if (fade === undefined) continue;
        const held = getComputedStyle(row).opacity;
        fade.cancel();
        exitFades.current.delete(id);
        if (rowVisible(row) && quickDuration >= STILL_MS) {
          row.animate([{ opacity: held }, { opacity: 1 }], {
            duration: quickDuration,
            easing: exitEasing,
          });
        }
      }
      for (const [id, from] of plan.travels) {
        const row = rows.get(id);
        if (row !== undefined && rowVisible(row)) travel(row, from, 0);
      }
      // The entrance waits only when it has something to wait for. The beat
      // exists so an arrival is never seen crossing a neighbour still leaving
      // its slot; with nothing travelling there is no one to cross, and a
      // first session held invisible would leave the panel blank for the
      // length of the hold.
      const beat = plan.travels.size > 0 ? exitDuration : 0;
      for (const id of plan.arrivals) {
        const row = rows.get(id);
        if (row === undefined || !rowVisible(row)) continue;
        // The gap is already opening — the neighbours started travelling the
        // moment this row took up space — so the row itself waits out the
        // beat and then arrives the way the stack arrives: from one fan step
        // above, on the same spring, becoming opaque as it drops.
        if (quickDuration >= STILL_MS) {
          row.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: quickDuration,
            easing: exitEasing,
            delay: beat,
            fill: "backwards",
          });
        }
        if (fan > 0) travel(row, -fan, beat);
      }
    } catch {
      // Nothing to unwind: additive travels decay to zero on their own.
    }
  });

  return listRef;
}

/**
 * One row as the list actually draws it: a session, and whether it is on its
 * way out. A leaving row still holds its slot — the gap only closes once it
 * has finished fading — but it is already gone from the model, so the panel
 * renders it inert.
 */
export interface RosterRow<T> {
  session: T;
  leaving: boolean;
}

interface Departure<T> {
  session: T;
  /** The slot it held when it left, so it fades where the reader last saw it. */
  index: number;
}

interface RosterState<T> {
  /** The list this roster was derived from, so a new one is noticed in render. */
  sessions: readonly T[];
  departures: readonly Departure<T>[];
}

/** The rows to draw: the living list, with each departure still in its slot. */
export function rosterRows<T extends { id: string }>(
  sessions: readonly T[],
  departures: readonly Departure<T>[],
): readonly RosterRow<T>[] {
  const rows: RosterRow<T>[] = sessions.map((session) => ({ session, leaving: false }));
  // Ascending, so each splice lands at the slot measured against the rows
  // already re-inserted below it.
  for (const departure of [...departures].sort((first, second) => first.index - second.index)) {
    rows.splice(Math.min(departure.index, rows.length), 0, {
      session: departure.session,
      leaving: true,
    });
  }
  return rows;
}

/**
 * The departures after a new list arrives: everything already fading that has
 * not come back, plus every drawn row the new list no longer contains, held at
 * the slot it was drawn in. A session that returns mid-fade is simply alive
 * again — its departure is dropped and the row it kept is the row it resumes.
 */
export function nextDepartures<T extends { id: string }>(
  drawn: readonly RosterRow<T>[],
  sessions: readonly T[],
  departures: readonly Departure<T>[],
): readonly Departure<T>[] {
  const alive = new Set(sessions.map((session) => session.id));
  const kept = departures.filter((departure) => !alive.has(departure.session.id));
  const leaving = new Set(kept.map((departure) => departure.session.id));
  const next = [...kept];
  drawn.forEach((row, index) => {
    if (!alive.has(row.session.id) && !leaving.has(row.session.id)) {
      next.push({ session: row.session, index });
    }
  });
  return next;
}

/**
 * The departures once one of them has been let go. Each index was taken while
 * every other departure still held its slot, so the rows below the vanished
 * one step up a place — without that, a session still fading would be spliced
 * one slot too far into the shorter list and jump mid-fade.
 */
export function withoutDeparture<T extends { id: string }>(
  departures: readonly Departure<T>[],
  id: string,
): readonly Departure<T>[] {
  const gone = departures.find((departure) => departure.session.id === id);
  if (gone === undefined) return departures;
  return departures
    .filter((departure) => departure.session.id !== id)
    .map((departure) =>
      departure.index > gone.index ? { ...departure, index: departure.index - 1 } : departure,
    );
}

/**
 * Holds each departed session on screen for the exit beat, so a removal is a
 * fade and then a closing gap rather than a row vanishing between frames. The
 * beat is `--duration-exit`, read at the moment of departure from the same
 * element the leaving fade inherits it through — a capture run zeroes the
 * token on the stage rather than at the root, and a roster that read the root
 * would hold a gap open for 90ms after the fade had already finished — so the
 * two always let go together. The root is only the fallback for a commit with
 * no list to read, where no row is drawn and the beat times nothing visible.
 */
export function useSessionRoster<T extends { id: string }>(
  sessions: readonly T[],
  stage: RefObject<HTMLElement | null>,
): readonly RosterRow<T>[] {
  const [state, setState] = useState<RosterState<T>>({ sessions, departures: [] });

  // Derived during render rather than in an effect: an effect runs after the
  // commit, and the commit is exactly when React would have unmounted the
  // departing row this roster exists to keep.
  if (state.sessions !== sessions) {
    setState({
      sessions,
      departures: nextDepartures(
        rosterRows(state.sessions, state.departures),
        sessions,
        state.departures,
      ),
    });
  }

  const timers = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const pending = timers.current;
    const leaving = new Set(state.departures.map((departure) => departure.session.id));
    for (const [id, timer] of pending) {
      if (!leaving.has(id)) {
        window.clearTimeout(timer);
        pending.delete(id);
      }
    }
    for (const departure of state.departures) {
      const id = departure.session.id;
      if (pending.has(id)) continue;
      const beat = parseMilliseconds(
        getComputedStyle(stage.current ?? document.documentElement).getPropertyValue(
          MOTION_TOKEN.EXIT_DURATION,
        ),
      );
      pending.set(
        id,
        window.setTimeout(() => {
          pending.delete(id);
          setState((previous) => ({
            ...previous,
            departures: withoutDeparture(previous.departures, id),
          }));
        }, beat),
      );
    }
  }, [state.departures, stage]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);

  return rosterRows(state.sessions, state.departures);
}
