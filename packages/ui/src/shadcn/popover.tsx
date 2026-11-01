import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "../cn.js";

/**
 * popover.tsx -- shadcn/ui's popover (style `base-nova`, on Base UI's popover), vendored and drawn as a menu's panel hung from the control that opened it.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add popover` reads as a small diff. Luke's
 * changes: the popup is the menu's surface, edge, corner, lift, and motion
 * (`PopoverPanel`'s card), with no padding of its own, since what it holds
 * lays itself out, never wider or taller than the window leaves it
 * (`--available-width`, `--available-height`), so a phone's screen
 * narrower than what it holds narrows it rather than cutting it off; it
 * hangs on the window's own layer, over a dialog's card
 * where its control stands in one (`layer`), because the card clips what
 * stands inside it; and the positioner takes the control (`anchor`), since
 * the control is `@luke/ui`'s own button. shadcn's trigger, header, title,
 * and description are left out. What an app draws is `@luke/ui`'s
 * `PopoverIconButton`; this is its inside.
 */

/** How far a popover keeps from the window's edges, as a menu keeps. */
const POPOVER_MARGIN = 8;

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverContent({
  className,
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  anchor,
  layer,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  > & {
    layer?: string | undefined;
  }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        collisionPadding={POPOVER_MARGIN}
        positionMethod="fixed"
        className="isolate z-menu data-[layer=dialog]:z-menu-over-dialog"
        data-layer={layer}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "luke-popover ph-no-capture flex max-h-(--available-height) max-w-(--available-width) flex-col overflow-hidden rounded-menu border border-border-strong bg-popover text-popover-foreground shadow-menu animate-menu-in data-ending-style:pointer-events-none data-ending-style:animate-menu-leave",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent };
