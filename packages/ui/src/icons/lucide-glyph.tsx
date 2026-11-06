import type { LucideIcon } from "lucide-react";
import React from "react";

import { ICON_STROKE_WIDTH } from "./icon-size.js";

void React;

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
