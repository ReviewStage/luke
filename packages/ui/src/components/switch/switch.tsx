import { SwitchButtonFrame, type SwitchButtonProps, SwitchMarkFrame } from "./switch-frame.js";

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

/** The switch as a button of its own. */
export function Switch(props: Omit<SwitchButtonProps, "className">): React.JSX.Element {
  return <SwitchButtonFrame {...props} />;
}

/** The switch's drawing alone, inside a control that is the switch. */
export function SwitchMark({ checked }: { checked: boolean }): React.JSX.Element {
  return <SwitchMarkFrame checked={checked} />;
}
