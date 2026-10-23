import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../cn.js";

/**
 * switch.tsx -- shadcn/ui's switch (style `base-nova`, on Base UI), vendored and drawn in Luke's switch inks.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add switch` reads as a small diff: Luke's track
 * and thumb sizes (a 34 by 20 pill, a 16px thumb), the switch's own inks
 * from the palette rather than `primary`, the thumb on the spring small
 * elements ride, the desktop's arrow cursor, and none of shadcn's outline
 * or ring utilities, because the window's own focus ring (`@luke/panel`'s
 * base.css) draws the keyboard's ring, and a utility would outrank it
 * (`shadcn-focus.test.ts`). `@luke/ui`'s `Switch`
 * (`components/switch/switch.tsx`) is what an app draws; this is its inside.
 * `SWITCH_TRACK` and `SWITCH_THUMB` are exported so the switch's drawing
 * alone, inside a row that is itself the switch, wears the same classes.
 */

/** The track: a pill in the switch's track ink that takes its "on" ink while checked. */
export const SWITCH_TRACK =
  "peer group/switch relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full border-0 bg-switch-track p-0.5 transition-colors duration-(--luke-duration-hover) data-checked:bg-switch-on data-disabled:opacity-40 cursor-pointer in-data-[luke-profile=desktop]:cursor-default data-disabled:cursor-default";

/** The thumb: a round of the switch's thumb ink, lifted by its shadow, slid by transform alone, and giving a little under a press held on an enabled switch. */
export const SWITCH_THUMB =
  "pointer-events-none block size-4 rounded-full bg-switch-thumb shadow-switch-thumb transition-transform duration-(--luke-duration-fast) ease-spring-fast data-checked:translate-x-3.5 group-data-checked/switch:translate-x-3.5 group-[:active:not([data-disabled])]/switch:scale-[0.85]";

export function ShadcnSwitch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root data-slot="switch" className={cn(SWITCH_TRACK, className)} {...props}>
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className={SWITCH_THUMB} />
    </SwitchPrimitive.Root>
  );
}
