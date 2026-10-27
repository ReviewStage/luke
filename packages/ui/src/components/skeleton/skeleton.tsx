import type { ReactNode } from "react";
import { cssCustomProperties } from "../../css.js";
import { SkeletonBlock } from "../../shadcn/skeleton.js";

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
 * `--luke-loop-motion` under reduced motion and a capture run. The blocks are
 * decoration: the region around them says what is being read, to a
 * reader and to nobody else.
 *
 * Only a component named `*Skeleton` draws these, through the components
 * the loaded surface draws with, so the blocks stand in the surface's own
 * boxes rather than a copy of them (`anti-slop/skeleton-through-components`,
 * root AGENTS.md's Layout). A block is shadcn/ui's skeleton
 * (`../../shadcn/skeleton.tsx`) drawn in Tailwind utilities over the theme,
 * each shape's box picked here; its breath alone is a rule of its own
 * (`skeleton.css`).
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

/**
 * Each shape's box: a line the words' height centred in their line, so a
 * column of blocks sits where the lines will, as wide as the share it is
 * given; a control's box; a circle as wide as it is given, a control's
 * height where it is not; or the whole box its container gives it.
 */
const SHAPE_CLASS: Record<SkeletonShape, string> = {
  [SKELETON_SHAPE.LINE]:
    "luke-skeleton w-[var(--luke-skeleton-width,100%)] h-skeleton-line my-skeleton-line-gap rounded-skeleton",
  [SKELETON_SHAPE.CONTROL]:
    "luke-skeleton w-[var(--luke-skeleton-width,100%)] h-control rounded-control",
  [SKELETON_SHAPE.CIRCLE]:
    "luke-skeleton w-[var(--luke-skeleton-width,var(--spacing-control))] aspect-square rounded-full",
  [SKELETON_SHAPE.BLOCK]: "luke-skeleton size-full rounded-control",
};

/** A block's shape and width, the width a share of its line or a length. */
interface SkeletonProps {
  shape?: SkeletonShape | undefined;
  /** How wide it stands, as a share of its line ("60%") or a length; the whole line where none is given. A block takes its container's width instead. */
  width?: string | undefined;
}

/** One block of `shape`, as wide as the share of its line given, or the whole line. */
export function Skeleton({ shape = SKELETON_SHAPE.LINE, width }: SkeletonProps): React.JSX.Element {
  return (
    <SkeletonBlock
      className={SHAPE_CLASS[shape]}
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
    <div className="luke-skeleton-region" role="status" aria-busy="true">
      <span className="luke-visually-hidden">{label}</span>
      {children}
    </div>
  );
}
