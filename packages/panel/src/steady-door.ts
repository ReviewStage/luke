import { useCallback, useRef } from "react";

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
    if (newest === undefined)
      throw new Error("A steady door was called before any was handed over.");
    return newest(...args);
  }, []);
  return door === undefined ? undefined : steady;
}

interface KeptPlace {
  readonly handed: unknown;
  readonly steady: unknown;
  readonly door: KeptDoor | undefined;
  readonly within: ReadonlyMap<string | number, KeptPlace> | undefined;
}

interface KeptDoor {
  newest: (...args: never[]) => unknown;
  readonly call: (...args: never[]) => unknown;
}

const DOOR_NAME = /^on[A-Z]/;

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

export function useSteadyDoors<Value>(value: Value): Value {
  const kept = useRef<KeptPlace | undefined>(undefined);
  const place = keptPlace(kept.current, value, false);
  kept.current = place;
  return place.steady as Value;
}

export function useSteadyDoorSet<Doors extends object>(doors: Doors): Doors {
  const kept = useRef<KeptPlace | undefined>(undefined);
  const place = keptPlace(kept.current, doors, false, () => true);
  kept.current = place;
  return place.steady as Doors;
}
