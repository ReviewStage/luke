import type {
  ComponentType,
  FocusEventHandler,
  MouseEvent,
  PointerEventHandler,
  ReactElement,
  ReactNode,
  Ref,
} from "react";
import { useCallback, useRef } from "react";
import { cn } from "../../cn.js";
import { ChevronDownIcon } from "../../face/glyphs.js";
import {
  BUTTON_VARIANT,
  type BusyProps,
  Button,
  type ButtonVariant,
  IconButton,
} from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

interface SplitButtonHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

export type SplitButtonHint = ComponentType<{
  label: string | undefined;
  children: ReactElement<SplitButtonHintProps>;
}>;

export interface SplitButtonMenu {
  label: string;
  "aria-haspopup": "menu" | "listbox" | "dialog";
  "aria-expanded": boolean;
  "aria-controls"?: string | undefined;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  ref?: Ref<HTMLButtonElement> | undefined;
}

const SPLIT_BOX = cn(
  "ui-split-button inline-flex flex-none items-center min-w-0 max-w-full",
  "[&>.ui-button:first-child]:border-e-0 [&>.ui-button:first-child]:rounded-e-none",
  "[&>.ui-button:last-child]:rounded-s-none",
  "fold-folded:[&>.ui-button:first-child]:w-control",
  "fold-folded:[&>.ui-button:first-child]:p-0",
  "fold-folded:[&>.ui-button:first-child_.ui-button-words]:sr-only",
  "fold-bare:[&>.ui-button:first-child]:w-control",
  "fold-bare:[&>.ui-button:first-child]:p-0",
  "fold-bare:[&>.ui-button:first-child_.ui-button-words]:sr-only",
  "fold-bare:[&>.ui-button:first-child]:border-e",
  "fold-bare:[&>.ui-button:first-child]:rounded-control",
  "fold-bare:[&>.ui-button:last-child]:hidden",
);

const SPLIT_FILLED_RULE =
  "[&>.ui-button:last-child]:border-s-[color-mix(in_srgb,var(--ui-button-ink)_30%,transparent)]";

const FILLED: ReadonlySet<ButtonVariant> = new Set([
  BUTTON_VARIANT.PRIMARY,
  BUTTON_VARIANT.DANGER,
  BUTTON_VARIANT.INK,
]);

export function SplitButton({
  variant = BUTTON_VARIANT.QUIET,
  icon,
  label,
  children,
  onClick,
  disabled,
  busy,
  busyLabel,
  succeeded,
  hint: Hint = Tooltip,
  hintLabel,
  menu,
  onMainPress,
}: BusyProps & {
  variant?: ButtonVariant | undefined;
  icon?: ReactNode;
  label?: string | undefined;
  children: ReactNode;
  onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  disabled?: boolean | undefined;
  succeeded?: boolean | undefined;
  hint?: SplitButtonHint | undefined;
  hintLabel?: string | undefined;
  menu: SplitButtonMenu;
  onMainPress?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
}): React.JSX.Element {
  const { label: menuLabel, ...trigger } = menu;
  const chevron = useRef<HTMLButtonElement | null>(null);
  const { ref: triggerRef, ...triggerProps } = trigger;
  const chevronRef = useCallback(
    (element: HTMLButtonElement | null) => {
      chevron.current = element;
      if (typeof triggerRef === "function") triggerRef(element);
      else if (triggerRef !== undefined && triggerRef !== null) triggerRef.current = element;
    },
    [triggerRef],
  );
  const busyProps = { busy: busy === true, busyLabel: busyLabel ?? "", succeeded };
  const main = (
    <Button
      variant={variant}
      icon={icon}
      label={label}
      disabled={disabled}
      focusableWhenDisabled
      onClick={onClick}
      {...busyProps}
    >
      {children}
    </Button>
  );
  return (
    <span
      className={cn(SPLIT_BOX, FILLED.has(variant) && SPLIT_FILLED_RULE)}
      data-variant={variant}
      onClickCapture={
        onMainPress === undefined
          ? undefined
          : (event) => {
              const target = event.target;
              if (!(target instanceof Node && chevron.current?.contains(target)))
                onMainPress(event);
            }
      }
    >
      <Hint label={hintLabel}>{main}</Hint>
      <IconButton
        variant={variant}
        icon={<ChevronDownIcon />}
        label={menuLabel}
        disabled={disabled}
        focusableWhenDisabled
        {...triggerProps}
        ref={chevronRef}
      />
    </span>
  );
}
