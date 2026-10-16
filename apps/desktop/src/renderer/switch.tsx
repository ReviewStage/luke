import { searchAnchorProps } from "@luke/settings/settings-anchors";

/**
 * switch.tsx -- the app's one on/off switch: a pill whose thumb slides right and takes the accent while on.
 *
 * It is drawn two ways and looks the same in both. Given `onChange`, it is
 * its own button, `role="switch"` with the label as its name, as a Settings
 * row's and an MCP server's are. Without it, it is the drawing alone, inside a
 * row button that is itself the switch for the keyboard and the reader (a
 * menu's switch row), so it hides from the reader and carries no state but
 * what it draws. Either way it draws its state from its own `data-checked`,
 * so `settings.css` keys the thumb and the track once whatever element
 * carries `aria-checked`.
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

/** A class list of the switch's own class and the caller's. */
function switchClass(className: string | undefined): string {
  return className === undefined ? "switch" : `switch ${className}`;
}

/** The switch: a button of its own given `onChange`, else the drawing inside a row that is the switch. */
export function Switch(props: SwitchButtonProps | SwitchDrawingProps): React.JSX.Element {
  const thumb = <span className="switch-thumb" />;
  if (props.onChange === undefined) {
    return (
      <span
        className={switchClass(props.className)}
        data-checked={props.checked}
        aria-hidden="true"
      >
        {thumb}
      </span>
    );
  }
  const { checked, onChange, onMouseDown, label, id, describedBy, disabled, anchor, className } =
    props;
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      className={switchClass(className)}
      data-checked={checked}
      {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
      disabled={disabled}
      onMouseDown={onMouseDown}
      onClick={(event) => onChange(!checked, event)}
    >
      {thumb}
    </button>
  );
}
