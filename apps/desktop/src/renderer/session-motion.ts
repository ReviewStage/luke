import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * How the surfaces that draw the session set move when their order changes
 * under a reader. Two of them do: the panel's list of rows, and the wing's
 * strip of provider marks — one summary, drawn at two sizes, re-sorted by the
 * same poll.
 *
 * Every poll re-sorts the set, and React answers a new order by moving DOM
 * nodes — which repaints each element at its new position in one frame. A
 * session finishing its turn would teleport from the top of the list to the
 * middle, its provider's mark would hop across the wing, and the reader loses
 * both. So each list is measured on every commit, and an element found
 * somewhere new is started back where the reader last saw it and released —
 * on `--spring-fast`, because an element hopping a slot is a small thing
 * moving, not the surface resizing.
 *
 * Reorders come and go on the panel's own two-beat rule: content leaves before
 * the shape moves, and the shape moves before content arrives. A departing
 * element fades over `--duration-exit` while it still holds its slot (the
 * roster below keeps it rendered exactly that long), and only then do its
 * neighbours close the gap. An arriving one opens its gap first — it is
 * measured, so the neighbours travel at once — and only fades in after that
 * same beat, so it is never seen crossing a neighbour that has not yet left
 * its slot.
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
 * How each slot in the wing's strip names itself: a provider's mark by the
 * provider, and the overflow count by its own sentinel — the count is a slot
 * like any other, so it glides like any other.
 */
export const WING_SLOT_ID_ATTRIBUTE = "data-slot-id";

/**
 * How a workspace tray names itself to the measurement pass. A tray is a slot
 * of the list in its own right: when a re-sort moves the whole group, the
 * tray travels and its rows ride it — measured rows inside a measured tray
 * are translated only by their movement within it, which is usually nothing.
 * Without this the card would teleport to its new seat while its rows sprang
 * from their old one, clipped invisible outside the box they had not yet
 * caught up with.
 */
export const WORKSPACE_TRAY_ID_ATTRIBUTE = "data-tray-id";

/**
 * How an element says it is on its way out, in either list. The fade it
 * announces is drawn here rather than in the stylesheet, because the element's
 * own opacity transition carries an entrance of its own — the row's
 * panel-arrival stagger, the mark's unfold — and a return mid-fade would wait
 * out that entrance's delay before resuming. An animation never touches the
 * property underneath, so cancelling it is all a return takes — the element is
 * simply alive again, at once.
 */
export const LEAVING_ATTRIBUTE = "data-leaving";

const MOTION_TOKEN = {
  SPRING: "--spring",
  SPRING_FAST: "--spring-fast",
  SURFACE_DURATION: "--duration-shape",
  FAST_DURATION: "--duration-fast",
  EXIT_DURATION: "--duration-exit",
  EXIT_EASING: "--motion-exit",
  QUICK_DURATION: "--duration-quick",
  ROW_FAN: "--row-fan",
} as const;

type MotionToken = (typeof MOTION_TOKEN)[keyof typeof MOTION_TOKEN];

/**
 * One list this module watches: which attribute its elements carry, which way
 * they stack, and how an arrival enters. Everything else — the springs, the
 * beats, the additive travels — is the same gesture in either direction.
 */
interface ReorderList {
  /** The attribute each element of this list names itself with. */
  idAttribute: string;
  /**
   // SAFETY: The preceding check establishes the asserted contract.
   * The attribute a group of this list's elements travels as one under, when
   * the list has such groups at all. A grouped element's own travel is only
   * its movement within the group; the group's element carries the rest.
   */
  groupAttribute?: string;
  /** The element's layout position along the axis the list stacks in. */
  offset: (element: HTMLElement, container: HTMLElement) => number;
  /** A transform moving an element by so many pixels along that axis. */
  translate: (px: number) => string;
  /**
   * The container's own seat along that axis, when the list wants a shove of
   // SAFETY: The preceding check establishes the asserted contract.
   * the whole box run as one travel. Content arriving above the session list —
   * the search field — moves the container out from under every row at once;
   // SAFETY: The preceding check establishes the asserted contract.
   * rows measured within the container read that as stillness, and the
   * container itself makes the one move. Rows translated one by one would
   * cross the scrollport's top edge and be clipped mid-flight, which is why
   * the box travels rather than its contents.
   */
  origin?: (container: HTMLElement) => number;
  /**
   * Whether an arrival also travels in from one `--row-fan` step back, the way
   * the row stack arrives. The wing's marks do not: an arriving mark already
   * slides in on the stylesheet's own `@starting-style` gesture — the same
   * unfold the whole wing makes — so the hook only holds its fade to the beat.
   */
  arrivesFromFan: boolean;
}

/**
 * The session list: rows stacked top to bottom, arriving the way the stack
 * arrives. Rows are measured within their scroll container rather than from
 * the shared offset parent, so the search field standing the container aside
 * is the container's travel and never the rows'.
 */
const SESSION_LIST: ReorderList = {
  idAttribute: SESSION_ROW_ID_ATTRIBUTE,
  groupAttribute: WORKSPACE_TRAY_ID_ATTRIBUTE,
  offset: (element, container) => element.offsetTop - container.offsetTop,
  translate: (px) => `translateY(${px}px)`,
  origin: (container) => container.offsetTop,
  arrivesFromFan: true,
};

/**
 * The wing's strip: marks laid along the wing, resting against the shape's far
 // SAFETY: The preceding check establishes the asserted contract.
 * edge. The wing hangs off the housing and grows that edge as the shape
 * morphs — `--wing-bound` moves the left edge of the very element `offsetLeft`
 * is measured from, and the marks move with it — so a slot's position is its
 * distance from the anchored edge instead: measured from the moving one, a
 // SAFETY: The preceding check establishes the asserted contract.
 * morph would read as stillness and the marks would jump to the new edge in
 * one frame. The distance is negated so the numbers still grow the way the
 * axis runs and the travel arithmetic stays the plan's. Measuring the slot's
 * own near edge also keeps the overflow count still while only its digits
 * widen, because the digits grow away from the anchor.
 */
const WING_STRIP: ReorderList = {
  idAttribute: WING_SLOT_ID_ATTRIBUTE,
  offset: (element, _container) => element.offsetLeft - (element.offsetParent?.clientWidth ?? 0),
  translate: (px) => `translateX(${px}px)`,
  arrivesFromFan: false,
};

/** Movement smaller than a hairline is measurement noise, not a reorder. */
const TRAVEL_EPSILON = 0.5;

/**
 * Below this, a duration is a request for stillness rather than for very fast
 * motion: capture zeroes the tokens outright and reduced motion leaves 1ms so
 * transitions still fire their end events. Neither wants an animation started.
 */
export const STILL_MS = 2;

// SAFETY: The preceding check establishes the asserted contract.
/** "460ms" or "0.46s" from a computed token, taken as milliseconds. */
export function parseMilliseconds(value: string): number {
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (Number.isNaN(parsed)) return 0;
  return trimmed.endsWith("ms") ? parsed : parsed * 1000;
}

// SAFETY: The preceding check establishes the asserted contract.
/** "7px" from a computed token, taken as pixels. */
export function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export interface ReorderPlan {
  /**
   * Elements that persisted and moved: how far each must be offset, in pixels,
   * to appear back where it was before springing to where it now sits.
   */
  travels: ReadonlyMap<string, number>;
  /** Elements with no previous position: they arrived rather than moved. */
  arrivals: readonly string[];
}

const EMPTY_PLAN: ReorderPlan = { travels: new Map(), arrivals: [] };

/**
 * What moved, given where each element was and where it now is. With no
 * baseline at all — the first measurement of a freshly built list — nothing
 * "moved" and nothing "arrived"; the list simply is, and animating it would
 * replay an entrance the panel's own arrival already owns. A baseline of an
 * empty list is different: a session appearing in one the reader is watching
 * is an event. Elements that left are not planned for — their exit is the
 * roster's beat, and by the time they leave this measurement their nodes are
 * already gone.
 */
export function planReorder(
  previous: ReadonlyMap<string, number> | undefined,
  next: ReadonlyMap<string, number>,
): ReorderPlan {
  if (previous === undefined) return EMPTY_PLAN;

  const travels = new Map<string, number>();
  const arrivals: string[] = [];
  for (const [id, position] of next) {
    const before = previous.get(id);
    if (before === undefined) {
      arrivals.push(id);
      continue;
    }
    const travel = before - position;
    if (Math.abs(travel) > TRAVEL_EPSILON) travels.set(id, travel);
  }
  return { travels, arrivals };
}

/** Only elements a reader can see are worth moving; hidden ones just take their place. */
function elementVisible(element: HTMLElement): boolean {
  return element.checkVisibility({ opacityProperty: true });
}

/**
 * Watches one list across commits and turns every reorder into motion.
 * Returns the ref the list container must carry; a commit that unmounts the
 * container (the settings tab, the slot, the wing yielding to the meter) drops
 * the baseline, so the next list built starts still instead of animating
 * against positions from another life.
 */
function useReorderMotion<T extends HTMLElement>(list: ReorderList): RefObject<T | null> {
  const listRef = useRef<T | null>(null);
  const baseline = useRef<Map<string, number> | undefined>(undefined);
  const groupBaseline = useRef<Map<string, number> | undefined>(undefined);
  const baselineWidth = useRef<number | undefined>(undefined);
  const baselineOrigin = useRef<number | undefined>(undefined);
  const wasLeaving = useRef<Set<string>>(new Set());
  const exitFades = useRef<Map<string, Animation>>(new Map());

  // No dependency list: a reorder arrives as new props, but the measurement
  // has to follow every commit that could have moved an element, and a handful
  // of offset reads per commit costs less than proving which commits those are.
  useLayoutEffect(() => {
    const container = listRef.current;
    if (container === null) {
      baseline.current = undefined;
      groupBaseline.current = undefined;
      baselineWidth.current = undefined;
      baselineOrigin.current = undefined;
      wasLeaving.current = new Set();
      exitFades.current.clear();
      return;
    }

    const elements = new Map<string, HTMLElement>();
    // `offsetTop`/`offsetLeft` rather than a rect: it is the element's layout
    // position, blind to both the scroll and every animation still in flight,
    // so the baseline never needs correcting for either.
    const positions = new Map<string, number>();
    for (const element of container.querySelectorAll<HTMLElement>(`[${list.idAttribute}]`)) {
      const id = element.getAttribute(list.idAttribute);
      if (id === null) continue;
      elements.set(id, element);
      positions.set(id, list.offset(element, container));
    }

    // The groups are slots too, measured in their own namespace: a group's
    // travel is applied to the group's element, and the elements inside it
    // are translated only by their movement within it — riding the group is
    // the usual case, and it is a travel of nothing.
    const groupElements = new Map<string, HTMLElement>();
    const groupPositions = new Map<string, number>();
    if (list.groupAttribute !== undefined) {
      for (const element of container.querySelectorAll<HTMLElement>(`[${list.groupAttribute}]`)) {
        const id = element.getAttribute(list.groupAttribute);
        if (id === null) continue;
        groupElements.set(id, element);
        groupPositions.set(id, list.offset(element, container));
      }
    }

    // Elements whose leaving mark changed this commit: the newly departed
    // begin their fade, and the returned have theirs cancelled. A fade
    // belonging to an element no longer drawn died with its node and is only
    // forgotten here.
    const departed: [string, HTMLElement][] = [];
    const returned: [string, HTMLElement][] = [];
    const leaving = new Set<string>();
    for (const [id, element] of elements) {
      if (element.getAttribute(LEAVING_ATTRIBUTE) === "true") leaving.add(id);
      const was = wasLeaving.current.has(id);
      if (!was && leaving.has(id)) departed.push([id, element]);
      else if (was && !leaving.has(id)) returned.push([id, element]);
    }
    wasLeaving.current = leaving;
    for (const id of [...exitFades.current.keys()]) {
      if (!elements.has(id)) exitFades.current.delete(id);
    }

    const plan = planReorder(baseline.current, positions);
    baseline.current = positions;
    // A group with no baseline is chrome that just appeared — its rows carry
    // their own entrances — so only its travels are ever animated.
    const groupPlan = planReorder(groupBaseline.current ?? new Map(), groupPositions);
    groupBaseline.current = groupPositions;
    // Whether this commit moved the list's bound out from under it — the
    // wing's `--wing-bound` changing with the presentation is the one thing
    // that does. Elements measured against the anchored edge read that as the
    // travel it truly is, and it is a different gesture from a slot hop: the
    // surface is what moved, so they ride the surface's spring. The bound is
    // the box the offsets are measured against — the container's own
    // `offsetParent`, the same node the elements report theirs from — never
    // the container, which shrink-wraps its contents and holds its width
    // while the bound beneath it moves.
    const width = (container.offsetParent ?? container).clientWidth;
    const boundMoved =
      baselineWidth.current !== undefined &&
      Math.abs(width - baselineWidth.current) > TRAVEL_EPSILON;
    baselineWidth.current = width;
    // The container's own seat, for a list that asked to ride its shoves as
    // one object. The first measurement is a baseline like every other: a
    // freshly built list simply is where it is.
    const origin = list.origin?.(container);
    const originTravel =
      origin !== undefined && baselineOrigin.current !== undefined
        ? baselineOrigin.current - origin
        : 0;
    baselineOrigin.current = origin;
    const containerShoved = Math.abs(originTravel) > TRAVEL_EPSILON;
    if (
      plan.travels.size === 0 &&
      groupPlan.travels.size === 0 &&
      plan.arrivals.length === 0 &&
      departed.length === 0 &&
      returned.length === 0 &&
      !containerShoved
    ) {
      return;
    }

    const style = getComputedStyle(container);
    const token = (name: MotionToken) => style.getPropertyValue(name);
    const fastDuration = parseMilliseconds(token(MOTION_TOKEN.FAST_DURATION));
    if (fastDuration < STILL_MS) return;
    const springFast = token(MOTION_TOKEN.SPRING_FAST).trim() || "ease";
    const exitDuration = parseMilliseconds(token(MOTION_TOKEN.EXIT_DURATION));
    const quickDuration = parseMilliseconds(token(MOTION_TOKEN.QUICK_DURATION));
    const exitEasing = token(MOTION_TOKEN.EXIT_EASING).trim() || "ease";
    const fan = parsePixels(token(MOTION_TOKEN.ROW_FAN));
    // A travel the bound caused rides the shape's spring for the shape's whole
    // beat: the same curve over the same time holds a mark the same distance
    // inside the surface's edge for every frame of the morph, where the fast
    // spring would carry it past the edge onto the desktop.
    const travelDuration = boundMoved
      ? parseMilliseconds(token(MOTION_TOKEN.SURFACE_DURATION))
      : fastDuration;
    const travelSpring = boundMoved ? token(MOTION_TOKEN.SPRING).trim() || "ease" : springFast;

    const travel = (element: HTMLElement, from: number, delay: number) => {
      element.animate([{ transform: list.translate(from) }, { transform: list.translate(0) }], {
        duration: travelDuration,
        easing: travelSpring,
        delay,
        fill: "backwards",
        composite: "add",
      });
    };

    // A malformed token would throw out of `animate` and take the whole tree
    // down with the layout effect; the elements arriving in place is the
    // better failure.
    try {
      for (const [id, element] of departed) {
        if (!elementVisible(element) || exitDuration < STILL_MS) continue;
        exitFades.current.set(
          id,
          // From wherever the element's opacity is, held at nothing until the
          // roster lets the node go: the fade must outlive its own end,
          // because the property underneath still says the element is drawn.
          element.animate([{ opacity: getComputedStyle(element).opacity }, { opacity: 0 }], {
            duration: exitDuration,
            easing: exitEasing,
            fill: "forwards",
          }),
        );
      }
      for (const [id, element] of returned) {
        const fade = exitFades.current.get(id);
        if (fade === undefined) continue;
        const held = getComputedStyle(element).opacity;
        fade.cancel();
        exitFades.current.delete(id);
        if (elementVisible(element) && quickDuration >= STILL_MS) {
          element.animate([{ opacity: held }, { opacity: 1 }], {
            duration: quickDuration,
            easing: exitEasing,
          });
        }
      }
      // The shove itself: the box makes the one move its contents were
      // spared, springing from where it sat to where it now is. Rows and
      // trays ride it — any travel of their own below is movement within it —
      // and nothing is ever drawn past the box's own edges, because the
      // scrollport clips in the box's coordinates and moves with it.
      if (containerShoved && elementVisible(container)) travel(container, originTravel, 0);
      for (const [id, from] of groupPlan.travels) {
        const element = groupElements.get(id);
        if (element !== undefined && elementVisible(element)) travel(element, from, 0);
      }
      // How far the group an element rides in is already travelling. Its own
      // travel is what remains: usually nothing, because a group's elements
      // move with it, and the remainder when they also reordered inside it.
      const groupTravelOf = (element: HTMLElement): number => {
        if (list.groupAttribute === undefined) return 0;
        const group = element.closest<HTMLElement>(`[${list.groupAttribute}]`);
        const groupId = group?.getAttribute(list.groupAttribute);
        return groupId === null || groupId === undefined
          ? 0
          : (groupPlan.travels.get(groupId) ?? 0);
      };
      for (const [id, from] of plan.travels) {
        const element = elements.get(id);
        if (element === undefined || !elementVisible(element)) continue;
        const within = from - groupTravelOf(element);
        if (Math.abs(within) > TRAVEL_EPSILON) travel(element, within, 0);
      }
      // The entrance waits only when it has something to wait for. The beat
      // exists so an arrival is never seen crossing a neighbour still leaving
      // its slot; with nothing travelling there is no one to cross, and a
      // first element held invisible would leave the list blank for the
      // length of the hold.
      const beat = plan.travels.size > 0 ? exitDuration : 0;
      for (const id of plan.arrivals) {
        const element = elements.get(id);
        if (element === undefined || !elementVisible(element)) continue;
        // The gap is already opening — the neighbours started travelling the
        // moment this element took up space — so the element itself waits out
        // the beat and then arrives the way its own list arrives: the rows
        // from one fan step above, on the same spring, becoming opaque as
        // they drop; the marks on the slide the stylesheet already gives a
        // late mount.
        if (quickDuration >= STILL_MS) {
          element.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: quickDuration,
            easing: exitEasing,
            delay: beat,
            fill: "backwards",
          });
        }
        if (list.arrivesFromFan && fan > 0) travel(element, -fan, beat);
      }
    } catch {
      // Nothing to unwind: additive travels decay to zero on their own.
    }
  });

  return listRef;
}

/** The session list's reorder motion; the ref belongs on `.session-list`. */
export function useSessionReorderMotion(): RefObject<HTMLDivElement | null> {
  return useReorderMotion<HTMLDivElement>(SESSION_LIST);
}

/** The wing strip's reorder motion; the ref belongs on `.wing-marks`. */
export function useWingReorderMotion(): RefObject<HTMLSpanElement | null> {
  return useReorderMotion<HTMLSpanElement>(WING_STRIP);
}

/**
 // SAFETY: The preceding check establishes the asserted contract.
 * One slot as its list actually draws it: an occupant, and whether it is on
 * its way out. A leaving occupant still holds its slot — the gap only closes
 * once it has finished fading — but it is already gone from the model, so the
 * list renders it inert.
 */
export interface RosterRow<T> {
  item: T;
  leaving: boolean;
}

interface Departure<T> {
  item: T;
  /** The slot it held when it left, so it fades where the reader last saw it. */
  index: number;
}

interface RosterState<T> {
  /** The list this roster was derived from, so a new one is noticed in render. */
  items: readonly T[];
  departures: readonly Departure<T>[];
}

/** The slots to draw: the living list, with each departure still in its slot. */
export function rosterRows<T extends { id: string }>(
  items: readonly T[],
  departures: readonly Departure<T>[],
): readonly RosterRow<T>[] {
  const rows: RosterRow<T>[] = items.map((item) => ({ item, leaving: false }));
  // Ascending, so each splice lands at the slot measured against the rows
  // already re-inserted below it.
  for (const departure of [...departures].sort((first, second) => first.index - second.index)) {
    rows.splice(Math.min(departure.index, rows.length), 0, {
      item: departure.item,
      leaving: true,
    });
  }
  return rows;
}

/**
 * The departures after a new list arrives: everything already fading that has
 * not come back, plus every drawn occupant the new list no longer contains,
 * held at the slot it was drawn in. One that returns mid-fade is simply alive
 * again — its departure is dropped and the slot it kept is the slot it
 * resumes.
 */
export function nextDepartures<T extends { id: string }>(
  drawn: readonly RosterRow<T>[],
  items: readonly T[],
  departures: readonly Departure<T>[],
): readonly Departure<T>[] {
  const alive = new Set(items.map((item) => item.id));
  const kept = departures.filter((departure) => !alive.has(departure.item.id));
  const leaving = new Set(kept.map((departure) => departure.item.id));
  const next = [...kept];
  drawn.forEach((row, index) => {
    if (!alive.has(row.item.id) && !leaving.has(row.item.id)) {
      next.push({ item: row.item, index });
    }
  });
  return next;
}

/**
 * The departures once one of them has been let go. Each index was taken while
 * every other departure still held its slot, so the rows below the vanished
 * one step up a place — without that, an occupant still fading would be
 * spliced one slot too far into the shorter list and jump mid-fade.
 */
export function withoutDeparture<T extends { id: string }>(
  departures: readonly Departure<T>[],
  id: string,
): readonly Departure<T>[] {
  const gone = departures.find((departure) => departure.item.id === id);
  if (gone === undefined) return departures;
  return departures
    .filter((departure) => departure.item.id !== id)
    .map((departure) =>
      departure.index > gone.index ? { ...departure, index: departure.index - 1 } : departure,
    );
}

/**
 * Holds each departed occupant on screen for the exit beat, so a removal is a
 * fade and then a closing gap rather than an element vanishing between frames.
 * The beat is `--duration-exit`, read at the moment of departure from the same
 * element the leaving fade inherits it through — a capture run zeroes the
 * token on the stage rather than at the root, and a roster that read the root
 * would hold a gap open for 90ms after the fade had already finished — so the
 * two always let go together. The root is only the fallback for a commit with
 * no list to read, where nothing is drawn and the beat times nothing visible.
 */
export function useRoster<T extends { id: string }>(
  items: readonly T[],
  stage: RefObject<HTMLElement | null>,
): readonly RosterRow<T>[] {
  const [state, setState] = useState<RosterState<T>>({ items, departures: [] });

  // Derived during render rather than in an effect: an effect runs after the
  // commit, and the commit is exactly when React would have unmounted the
  // departing element this roster exists to keep.
  if (state.items !== items) {
    setState({
      items,
      departures: nextDepartures(
        rosterRows(state.items, state.departures),
        items,
        state.departures,
      ),
    });
  }

  const timers = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const pending = timers.current;
    const leaving = new Set(state.departures.map((departure) => departure.item.id));
    for (const [id, timer] of pending) {
      if (!leaving.has(id)) {
        window.clearTimeout(timer);
        pending.delete(id);
      }
    }
    for (const departure of state.departures) {
      const id = departure.item.id;
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

  return rosterRows(state.items, state.departures);
}
