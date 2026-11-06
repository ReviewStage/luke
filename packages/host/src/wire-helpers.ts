import { isWireString, type WireRecord } from "@repo/wire";

export function reporterOf(params: WireRecord): string | undefined {
  return isWireString(params.reporter) ? params.reporter : undefined;
}
