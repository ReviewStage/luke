import { cn } from "../cn.js";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn("[font-family:inherit] [text-box:trim-both_cap_alphabetic]", className)}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd data-slot="kbd-group" className={cn("inline-flex items-center", className)} {...props} />
  );
}

export { Kbd, KbdGroup };
