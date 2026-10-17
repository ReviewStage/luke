import type { ReactNode } from "react";
import { cssCustomProperties } from "../../css.js";

/**
 * skeleton-frame.tsx -- the skeleton's markup, which the barrel's `Skeleton`
 * and `SkeletonRegion` and the compatibility door's twins all draw, so they
 * are one placeholder.
 */

/** The shapes a placeholder stands in: a line of words, a control, or a person's circle. */
export const SKELETON_SHAPE = {
  LINE: "line",
  CONTROL: "control",
  CIRCLE: "circle",
} as const;

export type SkeletonShape = (typeof SKELETON_SHAPE)[keyof typeof SKELETON_SHAPE];

/** A block's shape and width, the width a share of its line or a length. */
export interface SkeletonFrameProps {
  shape?: SkeletonShape | undefined;
  /** How wide it stands, as a share of its line ("60%") or a length; the whole line where none is given. */
  width?: string | undefined;
  className?: string | undefined;
}

/** One block, wearing `className` beside its own where a caller still passes one. */
export function SkeletonFrame({
  shape = SKELETON_SHAPE.LINE,
  width,
  className,
}: SkeletonFrameProps): React.JSX.Element {
  return (
    <span
      className={className === undefined ? "luke-skeleton" : `luke-skeleton ${className}`}
      data-shape={shape}
      style={
        width === undefined ? undefined : cssCustomProperties({ "--luke-skeleton-width": width })
      }
      aria-hidden="true"
    />
  );
}

/** Blocks standing for something still being read, which `label` names to a reader. */
export function SkeletonRegionFrame({
  label,
  className,
  children,
}: {
  label: string;
  className?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={className} role="status" aria-busy="true">
      <span className="luke-visually-hidden">{label}</span>
      {children}
    </div>
  );
}
