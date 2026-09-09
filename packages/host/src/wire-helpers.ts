import { isWireString, type WireRecord } from "@sidecar/wire";

/**
 * The opaque reporter a client minted for the window that asked. It rides on
 * the change event so that window can skip echoing its own write back to
 * itself, and names nothing about the window to anyone else.
 */
export function reporterOf(params: WireRecord): string | undefined {
  return isWireString(params.reporter) ? params.reporter : undefined;
}
