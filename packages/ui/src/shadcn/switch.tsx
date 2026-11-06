import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../cn.js";
import { ignoredByReplay } from "../session-replay-marks.js";

export const SWITCH_TRACK =
  "peer group/switch relative inline-flex h-5 w-[34px] shrink-0 items-center rounded-full border-0 bg-switch-track p-0.5 transition-colors duration-(--ui-duration-hover) ease-motion-exit data-checked:bg-switch-on data-disabled:opacity-disabled cursor-press data-disabled:cursor-default pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:size-[max(100%,var(--ui-touch-target))] pointer-coarse:before:[transform:translate(-50%,-50%)] pointer-coarse:before:content-['']";

export const SWITCH_THUMB =
  "pointer-events-none block size-4 rounded-full bg-switch-thumb shadow-switch-thumb transition-transform duration-(--ui-duration-fast) ease-spring-fast data-checked:translate-x-3.5 group-data-checked/switch:translate-x-3.5 group-[:active:not([data-disabled])]/switch:scale-[0.85]";

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
