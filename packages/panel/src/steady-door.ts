/**
 * steady-door.ts -- a door that stands across draws while the one handed over is made afresh on each, and calls the newest.
 *
 * A page drawn again on each delivery of the window's state makes its
 * callbacks afresh, and a part drawn from one is drawn again for the new
 * one, though it does what the last did. A part that holds while what it is
 * handed does (`memo`) is handed the steady door instead.
 */

import { useCallback, useRef } from "react";

/**
 * The door handed over, standing across draws and calling the newest one;
 * none while none is handed over. Note that a door taken away and handed
 * over again is the same door, and that a call landing after one is taken
 * away reaches the last handed over, as a callback held from an earlier
 * draw would.
 */
export function useSteadyDoor<Args extends readonly unknown[], Answer>(
  door: (...args: Args) => Answer,
): (...args: Args) => Answer;
export function useSteadyDoor<Args extends readonly unknown[], Answer>(
  door: ((...args: Args) => Answer) | undefined,
): ((...args: Args) => Answer) | undefined;
export function useSteadyDoor<Args extends readonly unknown[], Answer>(
  door: ((...args: Args) => Answer) | undefined,
): ((...args: Args) => Answer) | undefined {
  const latest = useRef(door);
  if (door !== undefined) latest.current = door;
  const steady = useCallback((...args: Args): Answer => {
    const newest = latest.current;
    // Note that the steady door is handed out only once a door has been, so one always stands here.
    if (newest === undefined)
      throw new Error("A steady door was called before any was handed over.");
    return newest(...args);
  }, []);
  return door === undefined ? undefined : steady;
}
