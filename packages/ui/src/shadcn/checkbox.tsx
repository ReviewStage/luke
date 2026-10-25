import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "../cn.js";
import { CheckIcon } from "../face/glyphs.js";

/**
 * checkbox.tsx -- shadcn/ui's checkbox (style `base-nova`, on Base UI), vendored and drawn in Luke's field and accent inks.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add checkbox` reads as a small diff. Luke's
 * changes: a 14px box, the size of the platform's own it replaces, in a
 * field's ground inside a chosen row's edge, filled in the accent while
 * checked or mixed; Luke's check glyph rather than lucide's, and a dash for
 * a mixed box (`indeterminate`), which shadcn draws as a check; the tick
 * springing in from a little smaller as it lands, and the box giving under
 * a press held on an enabled one, on the spring small elements ride; the
 * desktop's arrow cursor; none of shadcn's field-group, invalid, or dark
 * utilities, which no Luke surface sets; and none of its outline or ring
 * utilities, because the window's own focus ring (`@luke/panel`'s base.css)
 * draws the keyboard's ring and a utility would outrank it
 * (`anti-slop/no-shadcn-focus-ring`). `@luke/ui`'s `Checkbox`
 * (`components/checkbox/checkbox.tsx`) is what an app draws; this is its inside.
 */

function Checkbox({ className, indeterminate, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        "peer relative flex size-[14px] shrink-0 items-center justify-center rounded-[4px] border border-control-edge bg-field text-on-accent transition-transform duration-(--luke-duration-fast) ease-spring-fast data-checked:border-accent-fill data-checked:bg-accent-fill data-indeterminate:border-accent-fill data-indeterminate:bg-accent-fill data-disabled:opacity-disabled active:not-data-disabled:not-data-readonly:scale-85 cursor-pointer in-data-[luke-profile=desktop]:cursor-default data-disabled:cursor-default data-readonly:cursor-default",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-transform duration-(--luke-duration-fast) ease-spring-fast data-starting-style:scale-70 [&>svg]:size-3 [&>svg]:text-current [&>svg]:stroke-3"
      >
        {indeterminate === true ? (
          <span className="block h-0.5 w-2 rounded-luke-full bg-current" />
        ) : (
          <CheckIcon />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
