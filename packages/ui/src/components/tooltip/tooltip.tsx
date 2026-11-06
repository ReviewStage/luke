import { type PointerEvent, type ReactNode, useRef } from "react";
import { HoverCard, HoverCardContent } from "../../shadcn/hover-card.js";
import { Tooltip, TooltipContent } from "../../shadcn/tooltip.js";

const CARD_CHOICE = "button, a[href]";

const HINT_COLLISION = { side: "flip", align: "shift", fallbackAxisSide: "none" } as const;

const BESIDE_COLLISION = { ...HINT_COLLISION, fallbackAxisSide: "end" } as const;

export const TOOLTIP_CHORD = "ui-tooltip-chord [--ui-shortcut-ink:var(--ui-color-tooltip-chord)]";

interface TooltipBase {
  id: string;
  anchor: HTMLElement;
  leaving?: boolean | undefined;
  ref?: ((element: HTMLElement | null) => void) | undefined;
}

function hintMarks(base: TooltipBase) {
  return {
    id: base.id,
    ref: base.ref,
    "data-leaving": base.leaving === true ? "" : undefined,
    inert: base.leaving === true,
  } as const;
}

export function TooltipPill({
  label,
  shortcut,
  ...base
}: TooltipBase & {
  label: string;
  shortcut?: ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip open>
      <TooltipContent
        anchor={base.anchor}
        collisionAvoidance={HINT_COLLISION}
        role="tooltip"
        {...hintMarks(base)}
      >
        {label}
        {shortcut}
      </TooltipContent>
    </Tooltip>
  );
}

export function TooltipCard({
  beside = false,
  onHover,
  onPress,
  onChoice,
  children,
  ...base
}: TooltipBase & {
  beside?: boolean;
  onHover?: (over: boolean) => void;
  onPress?: () => void;
  onChoice?: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const told = useRef<Event | undefined>(undefined);
  const hover = (over: boolean, event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch" || event.nativeEvent === told.current) return;
    told.current = event.nativeEvent;
    onHover?.(over);
  };
  return (
    <HoverCard open>
      <HoverCardContent
        anchor={base.anchor}
        side={beside ? "inline-end" : "bottom"}
        collisionAvoidance={beside ? BESIDE_COLLISION : HINT_COLLISION}
        role="tooltip"
        {...hintMarks(base)}
        onPointerEnter={(event) => hover(true, event)}
        onPointerLeave={(event) => hover(false, event)}
        onPointerDown={(event) => {
          event.stopPropagation();
          onPress?.();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (event.target instanceof Element && event.target.closest(CARD_CHOICE) !== null) {
            onChoice?.();
          }
        }}
      >
        {children}
      </HoverCardContent>
    </HoverCard>
  );
}
