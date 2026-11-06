import {
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@repo/wire";

export interface WireGuard<Value> {
  (value: unknown): boolean;
  readonly wireType?: Value;
}

export type WireGuardValue<Guard> = Guard extends WireGuard<infer Value> ? Value : never;

function isWireValue(value: UnparsedWireValue): boolean {
  if (value === undefined || value === null || isWireString(value) || isWireBoolean(value))
    return true;
  if (isWireNumber(value)) return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isWireValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isWireValue);
}

export function wireResult<Value>(
  guard: (value: UnparsedWireValue) => boolean = isWireValue,
): WireGuard<Value> {
  return (value) => guard(unparsedWire(value as WireBoundaryInput));
}
