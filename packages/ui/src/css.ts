import type { CSSProperties } from "react";

export function cssCustomProperties(properties: Record<string, string | number>): CSSProperties {
  return properties as CSSProperties;
}
