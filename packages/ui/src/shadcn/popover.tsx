import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "../cn.js";

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
            "ui-popover ph-no-capture flex max-h-(--available-height) flex-col overflow-hidden rounded-menu border border-border-strong bg-popover text-popover-foreground shadow-menu animate-menu-in data-ending-style:pointer-events-none data-ending-style:animate-menu-leave",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverContent };
