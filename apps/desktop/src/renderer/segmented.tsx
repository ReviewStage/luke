import { searchAnchorProps } from "./settings-anchors";

/**
 * segmented.tsx -- the app's one segmented control: a pick-one of a few short options in a trough, the chosen one filled.
 *
 * It is a radio group, as macOS's own segmented control reads to VoiceOver:
 * the group is named by its legend, each option is a radio checked while it
 * is the value, Tab lands on the checked option (the first while none is) and
 * leaves the group in one press, and the arrow keys move along it and choose
 * as they go. A press on the chosen option does nothing.
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

interface SegmentedProps<Value extends string> {
  /** The group's accessible name, which a sighted reader has from the row's own label. */
  legend: string;
  options: readonly SegmentedOption<Value>[];
  /** The chosen option, or nothing while none is. */
  value: Value | undefined;
  disabled?: boolean | undefined;
  /** The settings search id a result lands on. */
  anchor?: string | undefined;
  onChange: (value: Value) => void;
}

/** The segmented control over `options`, choosing `value`. */
export function Segmented<Value extends string>(props: SegmentedProps<Value>): React.JSX.Element {
  const { legend, options, value, disabled, anchor } = props;
  const tabStop = options.some((option) => option.value === value) ? value : options[0]?.value;
  const press = (pressed: Value) => {
    if (pressed !== value) props.onChange(pressed);
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
      className="segmented"
      {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
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
          className="segment"
          disabled={disabled}
          onClick={() => press(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
