import type { ReactNode } from "react";
import { cssCustomProperties } from "../../css.js";
import { SkeletonBlock } from "../../shadcn/skeleton.js";

export const SKELETON_SHAPE = {
  LINE: "line",
  CONTROL: "control",
  CIRCLE: "circle",
  BLOCK: "block",
} as const;

export type SkeletonShape = (typeof SKELETON_SHAPE)[keyof typeof SKELETON_SHAPE];

const SHAPE_CLASS: Record<SkeletonShape, string> = {
  [SKELETON_SHAPE.LINE]:
    "ui-skeleton w-[var(--ui-skeleton-width,100%)] h-skeleton-line my-skeleton-line-gap rounded-skeleton",
  [SKELETON_SHAPE.CONTROL]:
    "ui-skeleton w-[var(--ui-skeleton-width,100%)] h-control rounded-control",
  [SKELETON_SHAPE.CIRCLE]:
    "ui-skeleton w-[var(--ui-skeleton-width,var(--spacing-control))] aspect-square rounded-full",
  [SKELETON_SHAPE.BLOCK]: "ui-skeleton size-full rounded-control",
};

interface SkeletonProps {
  shape?: SkeletonShape | undefined;
  width?: string | undefined;
}

export function Skeleton({ shape = SKELETON_SHAPE.LINE, width }: SkeletonProps): React.JSX.Element {
  return (
    <SkeletonBlock
      className={SHAPE_CLASS[shape]}
      data-shape={shape}
      style={
        width === undefined ? undefined : cssCustomProperties({ "--ui-skeleton-width": width })
      }
      aria-hidden="true"
    />
  );
}

export function SkeletonRegion({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-skeleton-region" role="status" aria-busy="true">
      <span className="ui-visually-hidden">{label}</span>
      {children}
    </div>
  );
}
