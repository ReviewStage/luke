import {
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@sidecar/wire";

/**
 * A parser at the process boundary, carrying the type it admits so a table of
 * guards can be read back as a table of types. The phantom field is never
 * written: it exists so `WireGuard<infer Value>` can recover what a guard
 * stands for.
 */
export interface WireGuard<Value> {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A wire guard is the parser at a process boundary.
  (value: unknown): boolean;
  readonly wireType?: Value;
}

/** What a guard admits, recovered from the guard itself. */
export type WireGuardValue<Guard> = Guard extends WireGuard<infer Value> ? Value : never;

/** Whether a value is one structured clone can carry: primitives, arrays, and plain records of them. */
export function isWireValue(value: UnparsedWireValue): boolean {
  if (value === undefined || value === null || isWireString(value) || isWireBoolean(value))
    return true;
  if (isWireNumber(value)) return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isWireValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isWireValue);
}

/** One answer's guard, defaulting to the structured-clone shape alone. */
export function wireResult<Value>(
  guard: (value: UnparsedWireValue) => boolean = isWireValue,
): WireGuard<Value> {
  // SAFETY: an IPC payload is structured-clone data; unparsedWire is the boundary the guards parse.
  return (value) => guard(unparsedWire(value as WireBoundaryInput));
}
