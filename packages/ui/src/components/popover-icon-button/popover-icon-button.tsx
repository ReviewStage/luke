import type { PopoverRoot } from "@base-ui/react/popover";
import { type ReactNode, type RefObject, useRef } from "react";
import { Popover, PopoverContent } from "../../shadcn/popover.js";
import { type ButtonSize, type ButtonVariant, IconButton } from "../button/button.js";

const POPOVER_LAYER = {
  WINDOW: "window",
  DIALOG: "dialog",
} as const;

type PopoverLayer = (typeof POPOVER_LAYER)[keyof typeof POPOVER_LAYER];

function layerOf(button: HTMLElement | null): PopoverLayer {
  return button?.closest('[aria-modal="true"]') == null
    ? POPOVER_LAYER.WINDOW
    : POPOVER_LAYER.DIALOG;
}

const OUTSIDE_PRESS = "outside-press" satisfies PopoverRoot.ChangeEventReason;

function pressOnButton(
  details: PopoverRoot.ChangeEventDetails,
  button: HTMLElement | null,
): boolean {
  const target = details.event?.target;
  return (
    details.reason === OUTSIDE_PRESS && target instanceof Node && button?.contains(target) === true
  );
}

export function PopoverIconButton({
  icon,
  label,
  title,
  open,
  onOpenChange,
  size,
  variant,
  disabled,
  initialFocus,
  ref,
  children,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean, away: boolean) => void;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
  disabled?: boolean | undefined;
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  ref?: RefObject<HTMLButtonElement | null> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const own = useRef<HTMLButtonElement | null>(null);
  const button = ref ?? own;
  return (
    <>
      <IconButton
        ref={button}
        icon={icon}
        label={label}
        {...(size === undefined ? undefined : { size })}
        {...(variant === undefined ? undefined : { variant })}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(!open, false)}
      />
      <Popover
        open={open}
        onOpenChange={(next, details) => {
          if (!next && pressOnButton(details, button.current)) return;
          onOpenChange(next, !next && details.reason === OUTSIDE_PRESS);
        }}
      >
        <PopoverContent
          anchor={button}
          layer={layerOf(button.current)}
          aria-label={title}
          initialFocus={initialFocus ?? true}
          finalFocus={button}
        >
          {children}
        </PopoverContent>
      </Popover>
    </>
  );
}
