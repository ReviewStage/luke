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

/** What `useSteadyDoors` kept of one place in the value it was handed: what it was handed there, what it handed back, and what it kept beneath. */
interface KeptPlace {
  readonly handed: unknown;
  readonly steady: unknown;
  readonly door: KeptDoor | undefined;
  readonly within: ReadonlyMap<string | number, KeptPlace> | undefined;
}

/** A steady door, standing across draws, and the newest door it calls. */
interface KeptDoor {
  newest: (...args: never[]) => unknown;
  readonly call: (...args: never[]) => unknown;
}

/** A door's name: `onOpen`, `onChoose`, the press handlers a part is handed, whose identity no reader keys a read on. */
const DOOR_NAME = /^on[A-Z]/;

/** An object `useSteadyDoors` looks into: one made of plain fields, not a React element, a class's instance, or a collection. */
function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if ("$$typeof" in value) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function keptDoor(kept: KeptPlace | undefined, handed: (...args: never[]) => unknown): KeptPlace {
  const door: KeptDoor = kept?.door ?? {
    newest: handed,
    call: (...args: never[]) => door.newest(...args),
  };
  door.newest = handed;
  return { handed, steady: door.call, door, within: undefined };
}

function keptPlace(
  kept: KeptPlace | undefined,
  handed: unknown,
  doorName: boolean,
  isDoor: (key: string) => boolean = (key) => DOOR_NAME.test(key),
): KeptPlace {
  if (kept !== undefined && kept.handed === handed) return kept;
  if (doorName && typeof handed === "function") {
    return keptDoor(kept, handed as (...args: never[]) => unknown);
  }
  if (Array.isArray(handed)) {
    const within = new Map<number, KeptPlace>();
    const steady = handed.map((item: unknown, index) => {
      const place = keptPlace(kept?.within?.get(index), item, false, isDoor);
      within.set(index, place);
      return place.steady;
    });
    const last = kept?.steady;
    const same =
      Array.isArray(last) &&
      last.length === steady.length &&
      steady.every((item, index) => item === last[index]);
    return { handed, steady: same ? last : steady, door: undefined, within };
  }
  if (isPlainRecord(handed)) {
    const within = new Map<string, KeptPlace>();
    const steady: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(handed)) {
      const place = keptPlace(kept?.within?.get(key), item, isDoor(key), isDoor);
      within.set(key, place);
      steady[key] = place.steady;
    }
    const last = kept?.steady;
    const same =
      isPlainRecord(last) &&
      Object.keys(last).length === within.size &&
      Object.entries(steady).every(([key, item]) => key in last && last[key] === item);
    return { handed, steady: same ? last : steady, door: undefined, within };
  }
  return { handed, steady: handed, door: undefined, within: undefined };
}

/**
 * The value handed over, made afresh on each draw, handed back as the one
 * handed back last wherever it says the same, as the window's document keeps
 * the identity of what a delivery did not change (`use-app-state.ts`'s
 * `adopted`): every object and array whose fields and items are the same as
 * they were is the one handed back last, and every door, a function under an
 * `on…` name, is a steady door calling the newest. A part that holds while
 * what it is handed does (`memo`) then holds for every draw that changed
 * nothing it reads. Note that only doors are made steady: a reader such as
 * `readSkills` is handed back as it is, because a new one means something
 * new to read.
 */
export function useSteadyDoors<Value>(value: Value): Value {
  const kept = useRef<KeptPlace | undefined>(undefined);
  const place = keptPlace(kept.current, value, false);
  kept.current = place;
  return place.steady as Value;
}

/**
 * A set of doors handed over afresh on each draw, every one of them a
 * steady door calling the newest, whatever it is named: the ways back a
 * window's history hands its screens, which no reader keys a read on.
 */
export function useSteadyDoorSet<Doors extends object>(doors: Doors): Doors {
  const kept = useRef<KeptPlace | undefined>(undefined);
  const place = keptPlace(kept.current, doors, false, () => true);
  kept.current = place;
  return place.steady as Doors;
}
