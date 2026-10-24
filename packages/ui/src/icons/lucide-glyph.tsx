import type { LucideIcon } from "lucide-react";
import React from "react";

import { ICON_STROKE_WIDTH } from "./icon-size.js";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * lucide-glyph.tsx -- Lucide's drawing, as a glyph of the window's own.
 *
 * A glyph of ours takes no props and draws in the one stroke, sized by the
 * seat or the control it stands in. Lucide's components take a size and a
 * stroke of their own, so each is stood behind this: the same call a
 * `glyphs.tsx` glyph answers, with the window's weight instead of the
 * library's. `className` is the sizing class a call site already gave the
 * glyph it replaces.
 */
export function lucideGlyph(Drawing: LucideIcon, className?: string): () => React.JSX.Element {
  return function LucideGlyph(): React.JSX.Element {
    return (
      <Drawing
        className={className}
        strokeWidth={ICON_STROKE_WIDTH}
        aria-hidden="true"
        focusable="false"
      />
    );
  };
}
