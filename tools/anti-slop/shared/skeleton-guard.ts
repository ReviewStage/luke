export const SKELETON_GUARD_RULE = "anti-slop/skeleton-through-components";

export const SKELETON_BLOCKS: ReadonlySet<string> = new Set(["Skeleton", "SkeletonRegion"]);

export function isSkeletonComponent(name: string): boolean {
  return name.endsWith("Skeleton");
}

export function isSkeletonClass(name: string): boolean {
  return name.includes("skeleton");
}
