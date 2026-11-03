import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "../cn.js";
import { CheckIcon } from "../face/glyphs.js";
import { ignoredByReplay } from "../session-replay-marks.js";

/**
 * checkbox.tsx -- shadcn/ui's checkbox (style `base-nova`, on Base UI), vendored and drawn in our field and accent inks.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add checkbox` reads as a small diff. Our
 * changes: a 14px box, the size of the platform's own it replaces, in a
 * field's ground inside a chosen row's edge, filled in the accent while
 * checked or mixed; our check glyph rather than lucide's, and a dash for
 * a mixed box (`indeterminate`), which shadcn draws as a check; the tick
 * springing in from a little smaller as it fades in, and leaving the same
 * way on the exit's tokens, which Base UI holds it drawn through, the box's
 * fill settling as a hover does, and the box giving under a press held on
 * an enabled one, on the spring small elements ride; the
 * one press cursor (`cursor-press`); none of shadcn's field-group, invalid, or dark
 * utilities, which no surface of ours sets; and none of its outline or ring
 * utilities, because the window's own focus ring (`@repo/panel`'s base.css)
 * draws the keyboard's ring and a utility would outrank it
 * (`anti-slop/no-shadcn-focus-ring`); and its hidden input kept out of the
 * screen recording (`session-replay-marks.ts`). `@repo/ui`'s `Checkbox`
 * (`components/checkbox/checkbox.tsx`) is what an app draws; this is its inside.
 */

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
