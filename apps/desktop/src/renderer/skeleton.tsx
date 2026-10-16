/**
 * skeleton.tsx -- the window's loading placeholders, which are `@luke/ui`'s shared `Skeleton` and `SkeletonRegion`.
 *
 * The window's callers still hand them a class of their own for their
 * screen's type and room, so they reach the shared placeholders through the
 * compatibility door, the same blocks with a class beside their own; each
 * moves onto the barrel's when its screen is migrated.
 */

export {
  CompatSkeleton as Skeleton,
  CompatSkeletonRegion as SkeletonRegion,
} from "@luke/ui/compat";
