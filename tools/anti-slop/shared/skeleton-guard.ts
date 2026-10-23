/**
 * skeleton-guard.ts -- the loading skeletons' guard as data: a skeleton's
 * blocks are drawn only by a `*Skeleton` component, which draws every other
 * box through the components the loaded state draws with. Read by the
 * `skeleton-through-components` rule and by the suppression check beside it.
 */
export const SKELETON_GUARD_RULE = "anti-slop/skeleton-through-components";

/** `@luke/ui`'s loading blocks, which only a skeleton draws. */
export const SKELETON_BLOCKS: ReadonlySet<string> = new Set(["Skeleton", "SkeletonRegion"]);

/** Whether a component, by its name, is a skeleton: `Skeleton` itself or one named `…Skeleton`. */
export function isSkeletonComponent(name: string): boolean {
  return name.endsWith("Skeleton");
}

/** Whether a class is a skeleton's own, laying its blocks out, rather than a box copied from the surface it stands for. */
export function isSkeletonClass(name: string): boolean {
  return name.includes("skeleton");
}
