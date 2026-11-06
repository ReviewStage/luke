import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "../cn.js";

export const AVATAR_ROOT =
  "relative inline-grid flex-none place-items-center overflow-hidden align-middle font-body font-emphasis select-none after:pointer-events-none after:absolute after:inset-0";

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
