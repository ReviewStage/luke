/**
 * place-binding.ts -- how the place the window stands on and the task the host binds it to follow each other, each on the other's edge.
 *
 * The host owns which task the window is bound to (`activeTaskId`), and
 * the window asks it for another (`useTaskAsk`), which counts as bound from
 * the moment it is asked (`boundFor`), so a press moves at once. The router
 * owns which place stands. A place declares what it holds of the binding
 * (`PLACE_BINDING`), and this module keeps the two in step without either
 * taking the other over:
 *
 * - Arriving on a place that holds no task, Home, asks the host to bind
 *   none, whichever door arrived there: Back, the sidebar, a link to `/app`.
 * - Arriving on a task's own place asks the host to bind that task, where
 *   the door that arrived there did not ask for it already: Back, Forward,
 *   a browser's own move.
 * - The host binding a task while Home or another task's place stands goes
 *   to that task's place, as a task started from the composer is opened;
 *   the host binding none under the task the window stands on goes to the
 *   place of no task, as a delete of the open task does.
 *
 * Each follows the edge of the other's change, never its level, so the two
 * never chase each other: arriving on Home with a task bound asks for none
 * and leaves nothing, and a task the host binds later leaves Home again.
 * Where both move in one reading, the arrival is the developer's own and
 * wins over the binding it found. The window's first reading is the host's
 * word over the place it opened on, as a launch on Home with a task bound
 * stands that task, and arrives nowhere.
 *
 * The arrivals are counted for the window's router (`usePlaceArrivals`),
 * every move of the developer's to another page, but for the binding's own
 * moves, so an answer landing late, as a refusal, can tell whether the
 * developer went anywhere since they pressed.
 */

import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RoutedPlace } from "./routed-places.js";

/**
 * What a place holds of the task the host binds the window to while it
 * stands (see the module's head): none, as Home is the page of no task bound,
 * so arriving on it asks the host to bind none and the host binding one
 * leaves it; the task bound itself, as the task's own place is that task's
 * page, so the host binding none under it gives way to the place of no
 * task; or whatever stands bound, kept as it is under it.
 */
export const PLACE_BINDING = {
  NONE: "none",
  TASK: "task",
  KEPT: "kept",
} as const;

export type PlaceBinding = (typeof PLACE_BINDING)[keyof typeof PLACE_BINDING];

/** What the binding is followed by: the place standing, where it is routed, the page it stands on, and the task bound for. */
interface BindingReading {
  readonly place: RoutedPlace | undefined;
  /** The task a task's own place stands on, by its address, where it is known. */
  readonly task: string | undefined;
  /** The path of any other place standing, which tells one of its pages from another. */
  readonly page: string | undefined;
  readonly bound: string | undefined;
}

/** The move one reading after another asks for: none, the host asked to bind none or the task arrived on, or the window moved to where the binding says. */
const BINDING_MOVE = {
  STAY: "stay",
  UNBIND: "unbind",
  SELECT: "select",
  TO_BOUND: "to-bound",
  TO_UNBOUND: "to-unbound",
} as const;

type BindingMove = (typeof BINDING_MOVE)[keyof typeof BINDING_MOVE];

/** What a place holds of the binding, the address the window's state draws, as a pairing's link, standing for the task's own. */
function bindingOf(place: RoutedPlace | undefined): PlaceBinding {
  return place?.binding ?? PLACE_BINDING.TASK;
}

/** Whether a place stands for no task bound. */
function holdsNone(place: RoutedPlace | undefined): boolean {
  return bindingOf(place) === PLACE_BINDING.NONE;
}

/** Whether a place is a task's own, which the address the window's state draws, as a pairing's link, stands for too. */
function holdsTask(place: RoutedPlace | undefined): boolean {
  return bindingOf(place) === PLACE_BINDING.TASK;
}

/** Whether `now` stands on another page than `before`: another place, another task's own, or another page of a place. */
function arrived(before: BindingReading, now: BindingReading): boolean {
  return now.place !== before.place || now.task !== before.task || now.page !== before.page;
}

/** The move from `before` to `now`, each side following the edge of the other's change. */
function bindingMove(before: BindingReading, now: BindingReading): BindingMove {
  // The developer arriving on a place of no task asks for none, over whatever the host bound in the same breath.
  if (now.place !== before.place && holdsNone(now.place)) {
    return now.bound === undefined ? BINDING_MOVE.STAY : BINDING_MOVE.UNBIND;
  }
  // The developer arriving on another task's own place asks for that task, over whatever the host bound in the same breath.
  if (arrived(before, now) && holdsTask(now.place) && now.task !== undefined) {
    return now.task === now.bound ? BINDING_MOVE.STAY : BINDING_MOVE.SELECT;
  }
  if (now.bound === before.bound) return BINDING_MOVE.STAY;
  if (now.bound !== undefined && holdsNone(now.place)) return BINDING_MOVE.TO_BOUND;
  // Note that only the task's own place follows the binding, never a place standing over it.
  if (now.bound !== undefined && holdsTask(now.place) && now.task !== undefined) {
    return now.task === now.bound ? BINDING_MOVE.STAY : BINDING_MOVE.TO_BOUND;
  }
  if (now.bound === undefined && holdsTask(now.place)) return BINDING_MOVE.TO_UNBOUND;
  return BINDING_MOVE.STAY;
}

/** The arrivals counted on a router's history, and where the binding's own move is on its way to, which is no arrival of the developer's. */
interface Arrivals {
  count: number;
  following: { readonly binding: PlaceBinding; readonly task: string | undefined } | undefined;
}

/** The arrivals counted beside each window's router history. */
const arrivalsBeside = new WeakMap<object, Arrivals>();

/** The arrivals counted beside `history`, made as they are first read. */
function arrivalsOf(history: object): Arrivals {
  const kept = arrivalsBeside.get(history);
  if (kept !== undefined) return kept;
  const made: Arrivals = { count: 0, following: undefined };
  arrivalsBeside.set(history, made);
  return made;
}

/** Counts `now` as the developer's arrival where it moved from `before` and is not where the binding's own move went. */
function countArrival(counted: Arrivals, before: BindingReading, now: BindingReading): void {
  if (!arrived(before, now)) return;
  const { following } = counted;
  counted.following = undefined;
  if (following?.binding === bindingOf(now.place) && following.task === now.task) return;
  counted.count += 1;
}

/**
 * Reads how many times the developer has arrived on another page of the
 * window, as the binding counted them; the binding's own moves, to the task
 * the host bound or to Home, are not counted. A door that moved the window
 * itself counts its own arrival, which is counted once the window is drawn
 * there.
 */
export function usePlaceArrivals(): () => number {
  const { history } = useRouter();
  return useCallback(() => arrivalsOf(history).count, [history]);
}

/** What the window's binding follows and the doors it moves by. */
export interface PlaceBindingInput {
  /** Whether the window knows where it stands; nothing is followed before it does. */
  readonly known: boolean;
  /** The routed place standing (`useWindowPlace`); none on an address the window's state draws. */
  readonly place: RoutedPlace | undefined;
  /** The task a task's own place stands on, by its address (`TaskRoute.taskId`); none where its address names none the window knows. */
  readonly task: string | undefined;
  /** The path of the place standing, but on a task's own place, whose task tells its pages apart. */
  readonly page: string | undefined;
  /** The task the window is bound for (`useTaskAsk`'s `boundFor`). */
  readonly bound: string | undefined;
  /** Asks the host to bind no task. */
  readonly onUnbind: () => void;
  /** Asks the host to bind the task arrived on. */
  readonly onSelect: (taskId: string) => void;
  /** Goes to the task bound's own place. */
  readonly onToBound: () => void;
  /** Goes to the place of no task, Home. */
  readonly onToUnbound: () => void;
}

/** Keeps the place standing and the host's binding in step, on the edge of each one's change (see the module's head). */
export function usePlaceBinding(input: PlaceBindingInput): void {
  const { known, place, task, page, bound } = input;
  const { history } = useRouter();
  const doors = useRef(input);
  doors.current = input;
  const read = useRef<BindingReading | undefined>(undefined);
  useEffect(() => {
    if (!known) {
      read.current = undefined;
      return;
    }
    const now = { place, task, page, bound };
    // Note that the first reading takes the place it opened on as already there, the binding as just made.
    const before = read.current ?? { place, task, page, bound: undefined };
    read.current = now;
    const counted = arrivalsOf(history);
    countArrival(counted, before, now);
    switch (bindingMove(before, now)) {
      case BINDING_MOVE.UNBIND:
        doors.current.onUnbind();
        return;
      case BINDING_MOVE.SELECT:
        if (task !== undefined) doors.current.onSelect(task);
        return;
      case BINDING_MOVE.TO_BOUND:
        counted.following = { binding: PLACE_BINDING.TASK, task: bound };
        doors.current.onToBound();
        return;
      case BINDING_MOVE.TO_UNBOUND:
        counted.following = { binding: PLACE_BINDING.NONE, task: undefined };
        doors.current.onToUnbound();
        return;
      case BINDING_MOVE.STAY:
        return;
    }
  }, [known, place, task, page, bound, history]);
}

/**
 * A task asked of the host, or the place of no task as none, and the task
 * open as it was asked: the ask stands only while that task is still the
 * open one, so the host's next move, whatever it is, answers it.
 */
interface TaskAsk {
  readonly taskId: string | undefined;
  readonly over: string | undefined;
}

/** The task the window is bound for, and the doors that ask the host for another. */
export interface TaskAsking {
  /** The task the window is bound for: the one last asked for while the task open is still the one it was asked over, else the task open. */
  readonly boundFor: string | undefined;
  /** Says `taskId`, or none, is bound for at once; answers the way to take the ask back, which takes back only this one. */
  readonly ask: (taskId: string | undefined) => () => void;
  /** Whether `taskId` is bound for as the window stands at the call, asked for or open. */
  readonly boundNow: (taskId: string) => boolean;
}

/** The task the host binds the window to, `open`, as the window asks for another (see the module's head). */
export function useTaskAsk(open: string | undefined): TaskAsking {
  const [asked, setAsked] = useState<TaskAsk | undefined>(undefined);
  const boundFor = asked !== undefined && asked.over === open ? asked.taskId : open;
  // Note that what is bound for is read at the call too, from the ask as it was last made or taken back rather than as it
  // was last drawn, since an arrival may be drawn before the ask that led there is.
  const latest = useRef<TaskAsk | undefined>(undefined);
  const openNow = useRef(open);
  openNow.current = open;
  // Note that the ask stands over the task open as it is made, though the door making it was handed long before, as a toast's is.
  const ask = useCallback((taskId: string | undefined) => {
    const made = { taskId, over: openNow.current };
    latest.current = made;
    setAsked(made);
    return () => {
      if (latest.current === made) latest.current = undefined;
      setAsked((held) => (held === made ? undefined : held));
    };
  }, []);
  const boundNow = useCallback((taskId: string) => {
    const made = latest.current;
    const standing =
      made !== undefined && made.over === openNow.current ? made.taskId : openNow.current;
    return standing === taskId;
  }, []);
  return { boundFor, ask, boundNow };
}
