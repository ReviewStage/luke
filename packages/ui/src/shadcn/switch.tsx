import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../cn.js";
import { ignoredByReplay } from "../session-replay-marks.js";

/**
 * switch.tsx -- shadcn/ui's switch (style `base-nova`, on Base UI), vendored and drawn in our switch inks.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add switch` reads as a small diff: our track
 * and thumb sizes (a 34 by 20 pill, a 16px thumb), the switch's own inks
 * from the palette rather than `primary`, the track's ink changing on the
 * fade's easing, the thumb on the spring small elements ride, the one press cursor (`cursor-press`), a press taken a finger's
 * width across on a coarse pointer, centered on the track, as every button's is (`button.css`), none of shadcn's outline
 * or ring utilities, because the window's own focus ring (`@repo/panel`'s
 * base.css) draws the keyboard's ring, and a utility would outrank it
 * (`anti-slop/no-shadcn-focus-ring`), and its hidden input kept out of the
 * screen recording (`session-replay-marks.tsx`). `@repo/ui`'s `Switch`
 * (`components/switch/switch.tsx`) is what an app draws; this is its inside.
 * `SWITCH_TRACK` and `SWITCH_THUMB` are exported so the switch's drawing
 * alone, inside a row that is itself the switch, wears the same classes.
 */

/** The track: a pill in the switch's track ink that takes its "on" ink while checked, taking a finger's press around it on a coarse pointer. */
export const SWITCH_TRACK =
  "peer group/switch relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full border-0 bg-switch-track p-0.5 transition-colors duration-(--ui-duration-hover) ease-motion-exit data-checked:bg-switch-on data-disabled:opacity-disabled data-readonly:opacity-disabled cursor-press data-disabled:cursor-default data-readonly:cursor-default pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:size-[max(100%,var(--ui-touch-target))] pointer-coarse:before:[transform:translate(-50%,-50%)] pointer-coarse:before:content-['']";

/** The thumb: a round of the switch's thumb ink, lifted by its shadow, slid by transform alone, and giving a little under a press held on an enabled switch. */
export const SWITCH_THUMB =
  "pointer-events-none block size-4 rounded-full bg-switch-thumb shadow-switch-thumb transition-transform duration-(--ui-duration-fast) ease-spring-fast data-checked:translate-x-3.5 group-data-checked/switch:translate-x-3.5 group-[:active:not([data-disabled]):not([data-readonly])]/switch:scale-[0.85]";

export function ShadcnSwitch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(SWITCH_TRACK, className)}
      {...props}
      inputRef={ignoredByReplay}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className={SWITCH_THUMB} />
    </SwitchPrimitive.Root>
  );
}
