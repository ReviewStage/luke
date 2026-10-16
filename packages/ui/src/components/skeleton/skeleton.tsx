import type { ReactNode } from "react";
import { SkeletonFrame, type SkeletonFrameProps, SkeletonRegionFrame } from "./skeleton-frame.js";

/**
 * skeleton.tsx -- the loading placeholder: quiet blocks in the shape of what is on its way.
 *
 * A line stands one line of words in whatever type it is set in, so a
 * caller shapes a heading or a row by the type it puts the block in rather
 * than by sizes of its own, and only its width is the caller's. A control
 * stands one control's box, and a circle a person's mark at the control's
 * glyph. Every block breathes on one opacity loop, in step so a wait reads as
 * one object, in the strong fill, and holds still with every other endless
 * loop on `--loop-motion` under reduced motion and a capture run. The blocks
 * are decoration: the region around them says what is being read, to a
 * reader and to nobody else.
 */

export { SKELETON_SHAPE, type SkeletonShape } from "./skeleton-frame.js";

/** One block of `shape`, as wide as the share of its line given, or the whole line. */
export function Skeleton(props: Omit<SkeletonFrameProps, "className">): React.JSX.Element {
  return <SkeletonFrame {...props} />;
}

/** Blocks standing for something still being read, which `label` names to a reader. */
export function SkeletonRegion(props: { label: string; children: ReactNode }): React.JSX.Element {
  return <SkeletonRegionFrame {...props} />;
}
