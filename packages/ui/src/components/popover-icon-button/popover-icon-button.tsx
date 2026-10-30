import type { PopoverRoot } from "@base-ui/react/popover";
import { type ReactNode, type RefObject, useRef } from "react";
import { Popover, PopoverContent } from "../../shadcn/popover.js";
import { type ButtonSize, type ButtonVariant, IconButton } from "../button/button.js";

/**
 * popover-icon-button.tsx -- a glyph button that hangs a panel of its own under it, on the window's layer, so nothing the button stands in clips the panel.
 *
 * The button is `IconButton`, saying it opens a dialog and whether that
 * dialog stands open. The panel is shadcn's popover on Base UI's
 * (`../../shadcn/popover.tsx`), drawn in a portal and placed against the
 * button, turning and sliding inside the window where the room below it runs
 * out, so a picker hung from a narrow column or from a dialog's card is never
 * cut by the box it was opened from. Over a dialog it stands above the
 * dialog's card (`aria-modal`, as a menu's layer is chosen). The owner holds
 * whether it stands open: a press on the button turns it, and Escape, a press
 * away from it and its button, or the focus leaving it puts it away, the
 * focus going back to the button; the owner is told when a press away put it
 * away (`away`), since the focus has already gone where that press took it,
 * which no blur says again once the panel is gone. Note that a press on the button while the
 * panel stands is the button's alone, which closes it, rather than also a
 * press away, which would close it only for the button's own press to open
 * it again.
 */

/** Which layer the panel stands in: the window's, or over a dialog's card. */
const POPOVER_LAYER = {
  WINDOW: "window",
  DIALOG: "dialog",
} as const;

type PopoverLayer = (typeof POPOVER_LAYER)[keyof typeof POPOVER_LAYER];

/** The layer a panel opened from `button` stands in. */
function layerOf(button: HTMLElement | null): PopoverLayer {
  return button?.closest('[aria-modal="true"]') == null
    ? POPOVER_LAYER.WINDOW
    : POPOVER_LAYER.DIALOG;
}

/** Base UI's reason for a press away from the panel. */
const OUTSIDE_PRESS = "outside-press" satisfies PopoverRoot.ChangeEventReason;

/** Whether a change asks the panel away for a press on its own button, which the button's press answers. */
function pressOnButton(
  details: PopoverRoot.ChangeEventDetails,
  button: HTMLElement | null,
): boolean {
  const target = details.event?.target;
  return (
    details.reason === OUTSIDE_PRESS && target instanceof Node && button?.contains(target) === true
  );
}

/**
 * A glyph button named `label` and the panel named `title` it hangs while
 * `open`, holding `children`; the focus lands on `initialFocus` as it opens,
 * or the panel itself.
 */
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
  /** The button's accessible name. */
  label: string;
  /** The panel's accessible name. */
  title: string;
  open: boolean;
  /** Hears the panel stand or go; `away` where a press away from it and its button put it away. */
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
