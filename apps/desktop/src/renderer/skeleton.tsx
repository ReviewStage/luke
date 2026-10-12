import type { ReactNode } from "react";

/**
 * skeleton.tsx -- the window's loading placeholder: quiet blocks in the shape of what is on its way.
 *
 * A block stands one line of words in whatever type it is set in, so a
 * caller shapes a heading or a row by the font it puts the block in rather
 * than by sizes of its own, and only its width is the caller's. Every block
 * breathes on one opacity loop, in step so a wait reads as one object, in the
 * raised token colour, and holds still with every other endless loop on
 * `--loop-motion` under reduced motion and a capture run (`skeleton.css`).
 * The blocks are decoration: the region around them says what is being read,
 * to a reader and to nobody else.
 */

/** One block, as wide as the share of its line given, or the whole line. */
export function Skeleton({
  width,
  className,
}: {
  width?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={className ? `skeleton ${className}` : "skeleton"}
      style={width === undefined ? undefined : { width }}
      aria-hidden="true"
    />
  );
}

/** Blocks standing for something still being read, which `label` names to a reader. */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={className} role="status" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {children}
    </div>
  );
}
