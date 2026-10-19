import { CHOICE_ROLE } from "../choice/choice-keys.js";
import { useChoiceKeys } from "../choice/use-choice-keys.js";

/**
 * segmented.tsx -- the one segmented control: a pick-one of a few short options in a trough, the chosen one filled.
 *
 * It is a radio group, as macOS's own segmented control reads to VoiceOver:
 * the group is named by its legend, each option is a radio checked while it
 * is the value, Tab lands on the checked option (the first while none is) and
 * leaves the group in one press, and the arrow keys move along it and choose
 * as they go, wrapping at either end, Home and End going to either end. A press on the chosen option does nothing, unless the control
 * is `clearable`, where it takes the choice back — an optional Inbox field's,
 * which has no other way to be left unanswered once picked. What finds the
 * control for an app (the desktop's settings search) is the app's: it hands
 * the group the `data-` attributes its search lands on.
 */

/** One option: the value it chooses and the words on it. */
interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
}

interface SegmentedBase<Value extends string> {
  /** The group's accessible name, which a sighted reader has from the row's own label. */
  legend: string;
  options: readonly SegmentedOption<Value>[];
  /** The chosen option, or nothing while none is. */
  value: Value | undefined;
  disabled?: boolean | undefined;
}

/** The attributes an app hands the group for finding it, its `data-` attributes alone. */
type AppAttributes = { [attribute: `data-${string}`]: string | undefined };

/** A control whose choice always stands once made. */
interface SegmentedFixed<Value extends string> extends SegmentedBase<Value> {
  clearable?: false | undefined;
  onChange: (value: Value) => void;
}

/** A control whose chosen option, pressed again, takes the choice back where `clearable` is on. */
interface SegmentedClearable<Value extends string> extends SegmentedBase<Value> {
  clearable: boolean;
  onChange: (value: Value | undefined) => void;
}

/** The segmented control over `options`, choosing `value`. */
export function Segmented<Value extends string>(
  props: (SegmentedFixed<Value> | SegmentedClearable<Value>) & AppAttributes,
): React.JSX.Element {
  const { legend, options, value, disabled, clearable: _, onChange: __, ...appAttributes } = props;
  const press = (pressed: Value) => {
    if (pressed !== value) props.onChange(pressed);
    else if (props.clearable === true) props.onChange(undefined);
  };
  // An arrow chooses the next option along and takes the keyboard there, wrapping at either end; Home and End go to either end.
  const keys = useChoiceKeys({
    options,
    value,
    role: CHOICE_ROLE.RADIO,
    disabled,
    onChoose: (chosen) => props.onChange(chosen),
  });
  return (
    <div
      role="radiogroup"
      aria-label={legend}
      {...appAttributes}
      className="luke-segmented"
      onKeyDown={keys.onKeyDown}
    >
      {options.map((option) => (
        // biome-ignore lint/a11y/useSemanticElements: a segment is drawn as a button in its trough, which a native radio cannot be, and speaks as the radio it behaves as.
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={keys.tabIndexOf(option.value)}
          className="luke-segment"
          disabled={disabled}
          onClick={() => press(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
