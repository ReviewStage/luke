/**
 * place-binding.ts -- how the place the window stands on and the task the host binds it to follow each other, each on the other's edge.
 *
 * The host owns which task the window is bound to (`activeTaskId`, asked
 * for as `boundFor`), and many doors bind one: the host itself, a start
 * from Home's composer, a key, a link. The router owns which place stands.
 * A place declares what it holds of the binding (`PLACE_BINDING`), and this
 * module keeps the two in step without either taking the other over:
 *
 * - Arriving on a place that holds no task, Home, asks the host to bind
 *   none, whichever door arrived there: Back, the sidebar, a link to `/app`.
 * - The host binding a task while such a place stands leaves it for the
 *   task; the host binding none under the task the window stands on goes to
 *   the place of no task.
 *
 * Each follows the edge of the other's change, never its level, so the two
 * never chase each other: arriving on Home with a task bound asks for none
 * and leaves nothing, and a task the host binds later leaves Home again.
 * Where both move in one reading, the arrival is the developer's own and
 * wins over the binding it found. The window's first reading is the host's
 * word over the place it opened on, as a launch on Home with a task bound
 * stands that task, and arrives nowhere.
 */

import { useEffect, useRef } from "react";
import { PLACE_BINDING, type RoutedPlace } from "./routed-places.js";

/** What the binding is followed by: the place standing, where it is routed, and the task bound for. */
interface BindingReading {
  readonly place: RoutedPlace | undefined;
  readonly bound: string | undefined;
}

/** The move one reading after another asks for: none, the host asked to bind none, or the window moved to where the binding says. */
const BINDING_MOVE = {
  STAY: "stay",
  UNBIND: "unbind",
  TO_BOUND: "to-bound",
  TO_UNBOUND: "to-unbound",
} as const;

type BindingMove = (typeof BINDING_MOVE)[keyof typeof BINDING_MOVE];

/** Whether a place stands for no task bound. */
function holdsNone(place: RoutedPlace | undefined): boolean {
  return place?.binding === PLACE_BINDING.NONE;
}

/** The move from `before` to `now`, each side following the edge of the other's change. */
function bindingMove(before: BindingReading, now: BindingReading): BindingMove {
  // The developer arriving on a place of no task asks for none, over whatever the host bound in the same breath.
  if (now.place !== before.place && holdsNone(now.place)) {
    return now.bound === undefined ? BINDING_MOVE.STAY : BINDING_MOVE.UNBIND;
  }
  if (now.bound === before.bound) return BINDING_MOVE.STAY;
  if (now.bound !== undefined && holdsNone(now.place)) return BINDING_MOVE.TO_BOUND;
  // Note that only the task's own place, the one no routed place stands over, gives way to the place of no task.
  if (now.bound === undefined && now.place === undefined) return BINDING_MOVE.TO_UNBOUND;
  return BINDING_MOVE.STAY;
}

/** What the window's binding follows and the doors it moves by. */
export interface PlaceBindingInput {
  /** Whether the window knows where it stands; nothing is followed before it does. */
  readonly known: boolean;
  /** The routed place standing (`useWindowPlace`); none on the task's own place. */
  readonly place: RoutedPlace | undefined;
  /** The task the window is bound for (`TasksControl.boundFor`). */
  readonly bound: string | undefined;
  /** Asks the host to bind no task. */
  readonly onUnbind: () => void;
  /** Leaves the place standing for the task bound. */
  readonly onToBound: () => void;
  /** Goes to the place of no task, Home. */
  readonly onToUnbound: () => void;
}

/** Keeps the place standing and the host's binding in step, on the edge of each one's change (see the module's head). */
export function usePlaceBinding(input: PlaceBindingInput): void {
  const { known, place, bound } = input;
  const doors = useRef(input);
  doors.current = input;
  const read = useRef<BindingReading | undefined>(undefined);
  useEffect(() => {
    if (!known) {
      read.current = undefined;
      return;
    }
    const now = { place, bound };
    // Note that the first reading takes the place it opened on as already there, the binding as just made.
    const before = read.current ?? { place, bound: undefined };
    read.current = now;
    switch (bindingMove(before, now)) {
      case BINDING_MOVE.UNBIND:
        doors.current.onUnbind();
        return;
      case BINDING_MOVE.TO_BOUND:
        doors.current.onToBound();
        return;
      case BINDING_MOVE.TO_UNBOUND:
        doors.current.onToUnbound();
        return;
      case BINDING_MOVE.STAY:
        return;
    }
  }, [known, place, bound]);
}
