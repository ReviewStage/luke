import { isRecord, type UnparsedWireValue, type WireRecord } from "@sidecar/core";

/** JSON or structured-clone input before wire guards run. */
export type WireBoundaryInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly WireBoundaryInput[]
  | { readonly [key: string]: WireBoundaryInput };

/** Accepts JSON or structured-clone input before wire guards run. */
export function unparsedWire(value: WireBoundaryInput): UnparsedWireValue {
  // SAFETY: WireBoundaryInput is the structured-clone shape; UnparsedWireValue is the same boundary one step in.
  return value as UnparsedWireValue;
}

/** Narrows JSON or IPC input before field guards run. */
export function wireRecord(value: UnparsedWireValue): WireRecord | undefined {
  return isRecord(value) ? value : undefined;
}
