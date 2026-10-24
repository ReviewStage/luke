import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "../cn.js";

/**
 * avatar.tsx -- shadcn/ui's avatar (style `base-nova`, on Base UI), vendored and drawn as Luke's disc.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add avatar` reads as a small diff. Its local
 * changes: the root is an inline grid that centres what stands in it, set
 * in the emphasis weight of the window's face, with an `::after` laid over it to carry an
 * edge, and with no size, type size, line, corner, ground, ink, or edge of
 * its own, because `@luke/ui`'s `Avatar` (`components/avatar/`) picks each
 * for each disc and `cn`'s merge knows none of their theme names to settle
 * a clash between the two (the line, `leading-none`, is set after the type
 * size, which the merge would otherwise drop it for); no `size` prop, since
 * `Avatar` sizes the box itself; the picture fills the
 * box absolutely rather than in flow, so the stand-in under it keeps its
 * place while it loads; and the fallback is a bare centring box with no
 * ground, ink, or type of its own, since the root draws them. Its
 * `AvatarBadge`, `AvatarGroup`, and `AvatarGroupCount` are dropped, because
 * nothing draws them: a facepile is the app's own row of discs.
 */

/** The disc: a box that centres its letter or glyph, clips its picture to its corner, and lays an edge over it. */
export const AVATAR_ROOT =
  "relative inline-grid flex-none place-items-center overflow-hidden align-middle font-body font-emphasis select-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit]";

function Avatar({ className, ...props }: AvatarPrimitive.Root.Props) {
  return (
    <AvatarPrimitive.Root data-slot="avatar" className={cn(AVATAR_ROOT, className)} {...props} />
  );
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("absolute inset-0 size-full object-cover", className)}
      {...props}
    />
  );
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn("flex size-full items-center justify-center", className)}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
