import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import { cn } from "../cn.js";
import { TOOLTIP_GAP, TOOLTIP_MARGIN, TOOLTIP_SURFACE } from "./tooltip.js";

function HoverCard({ ...props }: PreviewCardPrimitive.Root.Props) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardContent({
  className,
  side = "bottom",
  sideOffset = TOOLTIP_GAP,
  align = "start",
  alignOffset = 0,
  anchor,
  collisionAvoidance,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor" | "collisionAvoidance"
  >) {
  return (
    <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
      <PreviewCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        collisionPadding={TOOLTIP_MARGIN}
        collisionAvoidance={collisionAvoidance}
        positionMethod="fixed"
        className="isolate z-tooltip"
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            TOOLTIP_SURFACE,
            "ui-tooltip-card ph-no-capture pointer-events-auto flex w-tooltip-card cursor-default flex-col items-stretch gap-1 rounded-menu border border-border-strong bg-popover px-tooltip-card-inline py-1.5 font-text text-popover-foreground shadow-menu wrap-normal select-text",
            className,
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent };
