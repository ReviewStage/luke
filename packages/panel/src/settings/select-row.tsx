import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { ChipWidth, SettingsRowDensity } from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { refusalShown } from "../failure-report.js";
import { PickerRow } from "./picker-row.js";
import type { RowChange } from "./row-write.js";

/** What the menu says when a search over a short fixed set matches nothing, which it has no search to say. */
const NO_MATCH = "No options match";

/**
 * A settings pop-up: its name, optional why, and one value from a small fixed
 * set, picked from the app's own menu with no search, since a set this short
 * is read whole. The visible name names the chip and the why describes it.
 * A row that writes takes its caller's write (`row-write.ts`), resting until
 * it answers, and a refused one stands under the row, in its own error line;
 * a row that moves a draft takes a plain change.
 */
export function SelectRow<Value extends string | number>({
  label,
  labelReplayUnmasked,
  detail,
  value,
  options,
  parse,
  placeholder,
  anchor,
  changed,
  busy: restBusy,
  density,
  width,
  error,
  write,
  onChange,
}: RowChange<Value> & {
  label: string;
  /** Whether its name is the app's own words, which a screen recording shows as they read; masked where none is named. */
  labelReplayUnmasked?: boolean | undefined;
  detail?: string | undefined;
  value: Value;
  /** Each option's token and words, the faces it shows where it has some, and why it cannot be picked now where it cannot. */
  options: readonly {
    value: Value;
    label: string;
    faces?: React.ReactNode;
    disabled?: string | undefined;
  }[];
  parse: (raw: string) => Value | undefined;
  /** The empty search field's words, for a set long enough that its menu searches; none reads it whole. */
  placeholder?: string | undefined;
  /** The id a pressed search result lands on: marked on the chip itself, which then takes the keyboard. */
  anchor?: string;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean;
  /**
   * A sibling write in flight. Two pop-ups that store one setting share a
   * rest so one save cannot finish behind the other.
   */
  busy?: boolean;
  /** How the row stands; in a settings card where none is named. */
  density?: SettingsRowDensity | undefined;
  /** How wide its chip stands; the settings column where none is named. */
  width?: ChipWidth | undefined;
  /** What stops the caller's own save at this row, said where no write of the row's was refused. */
  error?: ShownError | undefined;
}): React.JSX.Element {
  const run = write === undefined ? onChange : write.run;
  const chosen = options.find((option) => option.value === value);
  return (
    <PickerRow
      label={label}
      labelReplayUnmasked={labelReplayUnmasked}
      detail={detail}
      changed={changed}
      saves={write?.savedAt}
      error={refusalShown(write?.refusal, FAILURE_SURFACE.SETTING_WRITE) ?? error}
      density={density}
      width={width}
      value={String(value)}
      valueLabel={chosen?.label ?? String(value)}
      valueIcon={chosen?.faces}
      rows={options.map((option) => ({
        id: String(option.value),
        label: option.label,
        ...(option.faces === undefined ? undefined : { faces: option.faces }),
        disabled: option.disabled,
      }))}
      placeholder={placeholder}
      noMatch={NO_MATCH}
      // Note that a select's options are a fixed set, the app's own words.
      replayUnmasked
      anchor={anchor}
      disabled={write?.busy === true || Boolean(restBusy)}
      onPick={(id) => {
        const next = parse(id);
        if (next !== undefined) run(next);
      }}
    />
  );
}
