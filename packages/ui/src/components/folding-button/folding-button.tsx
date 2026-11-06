import {
  type ComponentType,
  type FocusEventHandler,
  type MouseEvent,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useState,
} from "react";
import { cn } from "../../cn.js";
import {
  BUTTON_SHAPE,
  BUTTON_VARIANT,
  type BusyProps,
  Button,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
} from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

const FOLDING_BOX = cn(
  "ui-folding-button inline-flex flex-none min-w-0 max-w-full",
  "fold-folded:[&>.ui-button]:w-control",
  "fold-folded:[&>.ui-button]:p-0",
  "fold-folded:[&>.ui-button[data-size=compact]]:w-6",
  "fold-folded:[&_.ui-button-words]:sr-only",
);

const FOLDING_ROW = "flex w-full";

const FOLDED = "folded";

interface FoldingHintProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

export type FoldingButtonHint = ComponentType<{
  label: string | undefined;
  children: ReactElement<FoldingHintProps>;
}>;

function useFolded(): [(box: HTMLElement | null) => (() => void) | undefined, boolean] {
  const [folded, setFolded] = useState(false);
  const measured = useCallback((box: HTMLElement | null) => {
    if (box === null) return undefined;
    const observer = new ResizeObserver(() =>
      setFolded(getComputedStyle(box).getPropertyValue("--ui-fold").trim() === FOLDED),
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return [measured, folded];
}

interface FoldingButtonDoors {
  name?: string | undefined;
  "aria-haspopup"?: "menu" | "listbox" | "dialog" | undefined;
  "aria-expanded"?: boolean | undefined;
  "aria-controls"?: string | undefined;
  keepFocus?: boolean | undefined;
  tabbable?: boolean | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

function FoldingBox({
  measured,
  label,
  icon,
  variant,
  shape,
  size,
  busy,
  busyLabel,
  succeeded,
  turns,
  disabled,
  focusableWhenDisabled,
  onClick,
  trailing,
  doors,
  ...hinted
}: FoldingHintProps & {
  measured: (box: HTMLElement | null) => (() => void) | undefined;
  doors: FoldingButtonDoors;
  label: string;
  icon: ReactNode;
  variant: ButtonVariant;
  shape: ButtonShape | undefined;
  size: ButtonSize | undefined;
  busy: boolean | undefined;
  busyLabel: string | undefined;
  succeeded: boolean | undefined;
  turns: boolean | undefined;
  disabled: boolean | undefined;
  focusableWhenDisabled: boolean | undefined;
  onClick: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  trailing: ReactNode;
}): React.JSX.Element {
  const busyProps = { busy: busy === true, busyLabel: busyLabel ?? "", succeeded };
  return (
    <span
      ref={measured}
      className={cn(FOLDING_BOX, variant === BUTTON_VARIANT.ROW && FOLDING_ROW)}
      data-row={variant === BUTTON_VARIANT.ROW ? "" : undefined}
    >
      <Button
        ref={doors.ref}
        icon={icon}
        trailing={trailing}
        variant={variant}
        shape={shape ?? BUTTON_SHAPE.SQUARE}
        size={size}
        disabled={disabled}
        focusableWhenDisabled={focusableWhenDisabled}
        turns={turns}
        onClick={onClick}
        label={doors.name}
        aria-haspopup={doors["aria-haspopup"]}
        aria-expanded={doors["aria-expanded"]}
        aria-controls={doors["aria-controls"]}
        keepFocus={doors.keepFocus}
        tabbable={doors.tabbable}
        {...busyProps}
        {...hinted}
      >
        {label}
      </Button>
    </span>
  );
}

export function FoldingButton({
  label,
  icon,
  variant = BUTTON_VARIANT.QUIET,
  shape,
  size,
  busy,
  busyLabel,
  succeeded,
  turns,
  disabled,
  focusableWhenDisabled,
  onClick,
  trailing,
  hint: Hint = Tooltip,
  ...doors
}: FoldingButtonDoors &
  BusyProps & {
    label: string;
    icon: ReactNode;
    variant?: ButtonVariant;
    shape?: ButtonShape | undefined;
    size?: ButtonSize | undefined;
    succeeded?: boolean | undefined;
    turns?: boolean | undefined;
    disabled?: boolean | undefined;
    focusableWhenDisabled?: boolean | undefined;
    onClick?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
    trailing?: ReactNode;
    hint?: FoldingButtonHint | undefined;
  }): React.JSX.Element {
  const [measured, folded] = useFolded();
  const box = (
    <FoldingBox
      measured={measured}
      label={label}
      icon={icon}
      variant={variant}
      shape={shape}
      size={size}
      busy={busy}
      busyLabel={busyLabel}
      succeeded={succeeded}
      turns={turns}
      disabled={disabled}
      focusableWhenDisabled={focusableWhenDisabled}
      onClick={onClick}
      trailing={trailing}
      doors={doors}
    />
  );
  return <Hint label={folded ? label : undefined}>{box}</Hint>;
}
