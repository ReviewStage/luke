import type { ReactNode } from "react";
import { cssCustomProperties } from "../../css.js";

/**
 * skeleton.tsx -- the loading placeholder: quiet blocks in the shape of what is on its way.
 *
 * A line stands one line of words in whatever type it is set in, so a
 * caller shapes a heading or a row by the type it puts the block in rather
 * than by sizes of its own, and only its width is the caller's. A control
 * stands one control's box, a circle a person's mark at the control's
 * glyph, and a block the whole box its container gives it, so a plot's
 * stand-in takes its size from the room the plot will stand in. Every block
 * breathes on one opacity loop, in step so a wait reads as one object, in
 * the strong fill, and holds still with every other endless loop on
 * `--loop-motion` under reduced motion and a capture run. The blocks are
 * decoration: the region around them says what is being read, to a
 * reader and to nobody else.
 */

/**
 * The shapes a placeholder stands in: a line of words, a control, a person's
 * circle, or a block that fills the box its container gives it, a plot's or
 * a card's, so the container sets its size.
 */
export const SKELETON_SHAPE = {
  LINE: "line",
  CONTROL: "control",
  CIRCLE: "circle",
  BLOCK: "block",
} as const;

export type SkeletonShape = (typeof SKELETON_SHAPE)[keyof typeof SKELETON_SHAPE];

/** A block's shape and width, the width a share of its line or a length. */
interface SkeletonProps {
  shape?: SkeletonShape | undefined;
  /** How wide it stands, as a share of its line ("60%") or a length; the whole line where none is given. A block takes its container's width instead. */
  width?: string | undefined;
}

/** One block of `shape`, as wide as the share of its line given, or the whole line. */
export function Skeleton({ shape = SKELETON_SHAPE.LINE, width }: SkeletonProps): React.JSX.Element {
  return (
    <span
      className="luke-skeleton"
      data-shape={shape}
      style={
        width === undefined ? undefined : cssCustomProperties({ "--luke-skeleton-width": width })
      }
      aria-hidden="true"
    />
  );
}

/** Blocks standing for something still being read, which `label` names to a reader. */
export function SkeletonRegion({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div role="status" aria-busy="true">
      <span className="luke-visually-hidden">{label}</span>
      {children}
    </div>
  );
}
