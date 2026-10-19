import { CHOICE_BAR_LOOK, type ChoiceAppAttributes, ChoiceRow } from "../choice/choice-row.js";

/**
 * segmented.tsx -- the segmented control, a pick-one of a few short options in a trough, which is `ChoiceBar` in its segmented look as a radio group, kept under this name while its callers move to `ChoiceBar`.
 *
 * Everything a reader meets is `ChoiceBar`'s (`choice-bar.tsx`): a radio
 * group named by its legend, the chosen option on a thumb raised in the
 * trough, and, where the control is `clearable`, a press on the chosen
 * option taking the choice back. What is this module's own is its older
 * vocabulary: `legend` for `label`, `options` for `items`.
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
  props: (SegmentedFixed<Value> | SegmentedClearable<Value>) & ChoiceAppAttributes,
): React.JSX.Element {
  const { legend, options, value, disabled, clearable: _, onChange: __, ...appAttributes } = props;
  return (
    <ChoiceRow<Value>
      label={legend}
      options={options}
      value={value}
      onChoose={(chosen) => props.onChange(chosen)}
      onClear={props.clearable === true ? () => props.onChange(undefined) : undefined}
      look={CHOICE_BAR_LOOK.SEGMENTED}
      disabled={disabled}
      appAttributes={appAttributes}
    />
  );
}
