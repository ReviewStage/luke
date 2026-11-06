import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "../cn.js";
import { CheckIcon } from "../face/glyphs.js";
import { ignoredByReplay } from "../session-replay-marks.js";

function Checkbox({ className, indeterminate, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        "peer relative flex size-[14px] shrink-0 items-center justify-center rounded-[4px] border border-control-edge bg-field text-on-accent [transition:transform_var(--ui-duration-fast)_var(--ui-spring-fast),background-color_var(--ui-duration-hover)_var(--ui-motion-exit),border-color_var(--ui-duration-hover)_var(--ui-motion-exit)] data-checked:border-accent-fill data-checked:bg-accent-fill data-indeterminate:border-accent-fill data-indeterminate:bg-accent-fill data-disabled:opacity-disabled active:not-data-disabled:not-data-readonly:scale-85 cursor-press data-disabled:cursor-default data-readonly:cursor-default",
        className,
      )}
      {...props}
      inputRef={ignoredByReplay}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current [transition:transform_var(--ui-duration-fast)_var(--ui-spring-fast),opacity_var(--ui-duration-quick)_var(--ui-motion-exit)] data-starting-style:scale-70 data-starting-style:opacity-0 data-ending-style:scale-70 data-ending-style:opacity-0 data-ending-style:[transition:transform_var(--ui-duration-exit)_var(--ui-motion-exit),opacity_var(--ui-duration-exit)_var(--ui-motion-exit)] [&>svg]:size-3 [&>svg]:text-current [&>svg]:stroke-3"
      >
        {indeterminate === true ? (
          <span className="block h-0.5 w-2 rounded-ui-full bg-current" />
        ) : (
          <CheckIcon />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
