import type { ComponentPropsWithRef, MouseEvent } from "react";

/**
 * switch-frame.tsx -- the one switch's markup, in its two forms: a button that
 * is the switch, and the drawing alone inside a control that is. The barrel's
 * `Switch` and `SwitchMark` and the compatibility door's `CompatSwitch` all
 * draw these, so they are one control.
 */

/** The switch as a button of its own: `role="switch"`, named by `label`. */
export type SwitchButtonProps = {
  checked: boolean;
  /** Answers the state a press asks for, with the press, which a switch inside a pressable row stops from reaching the row. */
  onChange: (checked: boolean, event: MouseEvent<HTMLButtonElement>) => void;
  /** The switch's accessible name. */
  label: string;
  /** The id of the words that say what the switch does, where some stand beside it. */
  describedBy?: string | undefined;
} & Omit<
  ComponentPropsWithRef<"button">,
  "type" | "role" | "onChange" | "onClick" | "style" | "children" | "aria-checked" | "aria-label"
>;

/** The class list of a switch, with a caller's beside it where one is given. */
function switchClass(className: string | undefined): string {
  return className === undefined ? "luke-switch" : `luke-switch ${className}`;
}

/** The switch as its own button, wearing `className` beside its own where a caller still passes one. */
export function SwitchButtonFrame({
  checked,
  onChange,
  label,
  describedBy,
  className,
  ...button
}: SwitchButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      {...button}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy ?? button["aria-describedby"]}
      className={switchClass(className)}
      data-checked={checked}
      onClick={(event) => onChange(!checked, event)}
    >
      <span className="luke-switch-thumb" />
    </button>
  );
}

/** The drawing alone, hidden from a reader, inside a row that is the switch for the keyboard and the reader. */
export function SwitchMarkFrame({
  checked,
  className,
}: {
  checked: boolean;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <span className={switchClass(className)} data-checked={checked} aria-hidden="true">
      <span className="luke-switch-thumb" />
    </span>
  );
}
