import type { CSSProperties } from "react";

/** React's CSSProperties omits custom properties; this bridge is layout-only. */
export function cssCustomProperties(properties: Record<string, string | number>): CSSProperties {
  // SAFETY: The caller supplies only custom property names this surface's stylesheet reads.
  return properties as CSSProperties;
}
