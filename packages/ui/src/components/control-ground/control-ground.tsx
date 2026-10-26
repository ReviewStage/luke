import type { ReactNode } from "react";

/**
 * control-ground.tsx -- a region naming the ground its controls stand on, so a control's translucent fill reads the same over a tinted ground as over the column's.
 *
 * A choice's rows and a quiet or outlined button draw translucent fills,
 * which take the colour of whatever stands under them: over the attention
 * tint of a post that needs the reader, a gray row reads brownish. Inside
 * an `OPAQUE` region each lays its fill over the window's own ground
 * (`--luke-color-ground`), resting and lit alike, so it stands as it does
 * in the column, while the tint stays around it. A `CLEAR` region changes
 * nothing. The region draws no box of its own, so what holds it lays its
 * controls out as before.
 */

/** What a region's controls lay their fills over. */
export const CONTROL_GROUND = {
  /** Whatever stands under them, as everywhere else. */
  CLEAR: "clear",
  /** The window's own ground, for controls standing on a tint. */
  OPAQUE: "opaque",
} as const;

export type ControlGroundKind = (typeof CONTROL_GROUND)[keyof typeof CONTROL_GROUND];

/** Controls standing on the ground named. */
export function ControlGround({
  ground,
  children,
}: {
  ground: ControlGroundKind;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="luke-control-ground" data-ground={ground}>
      {children}
    </div>
  );
}
