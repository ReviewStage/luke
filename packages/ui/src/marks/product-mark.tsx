import { MARK_ART } from "@repo/brand";
import React from "react";

void React;

const GLYPH_VIEW_BOX = "-10 -10 120 120";

interface ProductMarkProps {
  muted?: boolean;
  fill?: boolean;
  inherit?: boolean;
  small?: boolean;
  glyph?: boolean;
}

export function ProductMark({
  muted = false,
  fill = false,
  inherit = false,
  small = false,
  glyph = false,
}: ProductMarkProps): React.JSX.Element {
  return (
    <svg
      className="ui-product-mark"
      viewBox={glyph ? GLYPH_VIEW_BOX : MARK_ART.VIEW_BOX}
      aria-hidden="true"
      focusable="false"
      data-muted={muted || undefined}
      data-fill={fill || undefined}
      data-inherit={inherit || undefined}
      data-glyph={glyph || undefined}
    >
      <path d={small ? MARK_ART.SMALL_PATH : MARK_ART.PATH} fill="currentColor" />
    </svg>
  );
}
