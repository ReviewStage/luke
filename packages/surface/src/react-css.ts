import type { CSSProperties } from "react";

/** React's CSSProperties omits custom properties; this bridge is layout-only. */
export function cssCustomProperties(properties: Record<string, string | number>): CSSProperties {
  // SAFETY: The caller supplies only custom property names this surface's stylesheet reads.
  return properties as CSSProperties;
}

/**
 * The custom properties the surface's own shape is driven by: written from the
 * renderer, spent by `base.css`. Named once here rather than spelled at each
 * write, because a property name is the seam between two files and a typo in
 * one of them is silent — the stylesheet simply falls back and the shape is
 * quietly the wrong size.
 */
export const SURFACE_PROPERTY = {
  NOTCH_TOP_INSET: "--notch-top-inset",
  NOTCH_HOUSING_WIDTH: "--notch-housing-width",
  PANEL_HEIGHT: "--panel-height",
  SLOT_HEIGHT: "--slot-height",
  FEEDBACK_HEIGHT: "--feedback-height",
  CAPTION_SIZE: "--caption-size",
} as const;

export type SurfaceProperty = (typeof SURFACE_PROPERTY)[keyof typeof SURFACE_PROPERTY];
