import type { ComponentPropsWithRef, MouseEvent } from "react";

/**
 * switch.tsx -- the app's one on/off switch: a pill whose thumb slides right and takes the accent while on.
 *
 * It comes in two forms that look alike and are kept apart by what they
 * are. A `Switch` is its own button, `role="switch"` with its label as its
 * name, as a Settings row's and an MCP server's are. A `SwitchMark` is the
 * drawing alone, inside a row button that is itself the switch for the
 * keyboard and the reader (a menu's switch row), so it hides from the reader
 * and carries no state but what it draws. Either way it draws its state from
 * its own `data-checked`, so one rule keys the thumb and the track whatever
 * element carries `aria-checked`. Only the thumb moves, only by transform, on
 * the spring small elements ride. What finds a switch for an app (the
 * desktop's settings search) is the app's: it hands the switch the
 * attributes its search lands on.
 */

/** The switch as a button of its own: `role="switch"`, named by `label`. */
type SwitchProps = {
  checked: boolean;
  /** Answers the state a press asks for, with the press, which a switch inside a pressable row stops from reaching the row. */
  onChange: (checked: boolean, event: MouseEvent<HTMLButtonElement>) => void;
  /** The switch's accessible name. */
  label: string;
  /** The id of the words that say what the switch does, where some stand beside it. */
  describedBy?: string | undefined;
} & Omit<
  ComponentPropsWithRef<"button">,
  | "type"
  | "role"
  | "onChange"
  | "onClick"
  | "className"
  | "style"
  | "children"
  | "aria-checked"
  | "aria-label"
>;

/** The switch as a button of its own. */
export function Switch({
  checked,
  onChange,
  label,
  describedBy,
  ...button
}: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      {...button}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy ?? button["aria-describedby"]}
      className="luke-switch"
      data-checked={checked}
      onClick={(event) => onChange(!checked, event)}
    >
      <span className="luke-switch-thumb" />
    </button>
  );
}

/** The switch's drawing alone, hidden from a reader, inside a control that is the switch. */
export function SwitchMark({ checked }: { checked: boolean }): React.JSX.Element {
  return (
    <span className="luke-switch" data-checked={checked} aria-hidden="true">
      <span className="luke-switch-thumb" />
    </span>
  );
}
