import { FACE_ART } from "@luke/brand";
import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * Luke's face as a still mark, drawn from the generated `FACE_ART` constants so
 * every page that wears it stays tied to the product artwork, in
 * `currentColor` so its holder's ink is its own. Decorative: whatever stands
 * beside it already says "Luke".
 *
 * Wider than tall, so it fills the box that holds it and the default
 * `xMidYMid meet` letterboxes the face inside that box rather than stretching
 * it. `WingFace` is the face that moves; this is the one that only sits there,
 * where an auth ring, a site's banner, or a gate card is drawn.
 */
export function FaceMark(): React.JSX.Element {
  const { MARK_VIEW_BOX, TILT, SMILE, STROKE_WIDTH, EYE_X, EYE_Y, EYE_RADIUS } = FACE_ART;
  return (
    <svg
      className="luke-face-mark"
      viewBox={MARK_VIEW_BOX}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={TILT}>
        <path
          d={SMILE}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={EYE_X.LEFT} cy={EYE_Y} r={EYE_RADIUS} fill="currentColor" />
        <circle cx={EYE_X.RIGHT} cy={EYE_Y} r={EYE_RADIUS} fill="currentColor" />
      </g>
    </svg>
  );
}
