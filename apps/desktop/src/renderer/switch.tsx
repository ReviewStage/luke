import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { CompatSwitchButton, CompatSwitchMark } from "@luke/ui/compat";

/**
 * switch.tsx -- the window's switch, which is `@luke/ui`'s shared `Switch`, and the settings search's landing on it.
 *
 * Given `onChange` it is the switch as its own button; without it, the
 * drawing alone inside a row button that is the switch. What is the
 * window's own is `anchor`: the settings search id a result lands on, which
 * this adapter hands the button as its search attribute. The window's
 * callers still pass a class of their own, so they reach the shared control
 * through the compatibility door, and each moves onto the barrel's `Switch`
 * or `SwitchMark` when its screen is migrated.
 */

/** The switch as a button of its own. */
interface SwitchButtonProps {
  checked: boolean;
  /** Answers the state a press asks for, with the press, which a switch inside a pressable row stops from reaching the row. */
  onChange: (checked: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
  /** What a press does as it begins, such as keeping the focus on a field the switch stands beside. */
  onMouseDown?: ((event: React.MouseEvent<HTMLButtonElement>) => void) | undefined;
  /** The switch's accessible name. */
  label: string;
  /** The button's id, where a visible label beside it names it by `htmlFor`. */
  id?: string | undefined;
  /** The id of the words that say what the switch does, where some stand beside it. */
  describedBy?: string | undefined;
  disabled?: boolean | undefined;
  /** The settings search id a result lands on, which the switch then takes the keyboard for. */
  anchor?: string | undefined;
  className?: string | undefined;
}

/** The switch drawn inside a row button that is the switch itself. */
interface SwitchDrawingProps {
  checked: boolean;
  onChange?: undefined;
  className?: string | undefined;
}

/** The switch: a button of its own given `onChange`, else the drawing inside a row that is the switch. */
export function Switch(props: SwitchButtonProps | SwitchDrawingProps): React.JSX.Element {
  if (props.onChange === undefined) {
    return <CompatSwitchMark checked={props.checked} className={props.className} />;
  }
  const { anchor, ...button } = props;
  return (
    <CompatSwitchButton
      {...button}
      {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
    />
  );
}
