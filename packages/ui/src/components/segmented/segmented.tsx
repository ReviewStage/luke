/**
 * segmented.tsx -- the one segmented control: a pick-one of a few short options in a trough, the chosen one filled.
 *
 * It is a radio group, as macOS's own segmented control reads to VoiceOver:
 * the group is named by its legend, each option is a radio checked while it
 * is the value, Tab lands on the checked option (the first while none is) and
 * leaves the group in one press, and the arrow keys move along it and choose
 * as they go. A press on the chosen option does nothing, unless the control
 * is `clearable`, where it takes the choice back — an optional Inbox field's,
 * which has no other way to be left unanswered once picked. What finds the
 * control for an app (the desktop's settings search) is the app's: it hands
 * the group the `data-` attributes its search lands on.
 */

/** The keys that step along the group, and which way. */
const STEP_KEYS = new Map([
  ["ArrowRight", 1],
  ["ArrowDown", 1],
  ["ArrowLeft", -1],
  ["ArrowUp", -1],
]);

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
  const tabStop = options.some((option) => option.value === value) ? value : options[0]?.value;
  const press = (pressed: Value) => {
    if (pressed !== value) props.onChange(pressed);
    else if (props.clearable === true) props.onChange(undefined);
  };
  // An arrow chooses the next option along and takes the keyboard there, wrapping at either end.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = STEP_KEYS.get(event.key);
    if (step === undefined || options.length === 0) return;
    event.preventDefault();
    const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const from = event.target instanceof HTMLButtonElement ? radios.indexOf(event.target) : -1;
    const to = (Math.max(from, 0) + step + options.length) % options.length;
    const next = options[to];
    if (next === undefined) return;
    radios[to]?.focus();
    if (next.value !== value) props.onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={legend}
      {...appAttributes}
      className="luke-segmented"
      onKeyDown={disabled === true ? undefined : onKeyDown}
    >
      {options.map((option) => (
        // biome-ignore lint/a11y/useSemanticElements: a segment is drawn as a button in its trough, which a native radio cannot be, and speaks as the radio it behaves as.
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === tabStop ? 0 : -1}
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
