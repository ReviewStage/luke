/**
 * The keyboard's ring belongs to the window: `packages/ui/README.md`'s
 * "Built on shadcn/ui" keeps it in its own sheet, and this holds the rule's
 * id and the files it watches, read by `no-shadcn-focus-ring` and by the
 * suppression check beside it.
 */
export const SHADCN_FOCUS_GUARD_RULE = "anti-slop/no-shadcn-focus-ring";

/** The vendored shadcn/ui components, which `@luke/ui`'s own components wrap, by repository path. */
export const SHADCN_SOURCE = /^packages\/ui\/src\/shadcn\/[^/]+\.tsx?$/u;
