import type { SettingsRowDensity } from "@luke/ui";
import { useSettingWrite } from "@luke/ui/use-setting-write";
import type { ActionResult } from "@luke/wire";
import { PickerRow } from "./picker-row";

/** What the menu says when a search over a short fixed set matches nothing, which it has no search to say. */
const NO_MATCH = "Nothing matches.";

/**
 * A settings pop-up: its name, optional why, and one value from a small fixed
 * set, picked from the app's own menu with no search, since a set this short
 * is read whole. The visible name names the chip and the why describes it;
 * a refused write stands under the row, in its own error line.
 */
export function SelectRow<Value extends string | number>({
  label,
  detail,
  value,
  options,
  parse,
  placeholder,
  anchor,
  changed,
  busy: restBusy,
  density,
  onChange,
}: {
  label: string;
  detail?: string | undefined;
  value: Value;
  /** Each option's token and words. A set with faces is a `PictureChoiceRow` instead. */
  options: readonly { value: Value; label: string }[];
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
  // biome-ignore lint/suspicious/noConfusingVoidType: the voice and pace cannot be refused, so those writes answer void
  onChange: (value: Value) => void | Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChange);
  const chosen = options.find((option) => option.value === value);
  return (
    <PickerRow
      label={label}
      detail={detail}
      changed={changed}
      error={rejection}
      density={density}
      value={String(value)}
      valueLabel={chosen?.label ?? String(value)}
      rows={options.map((option) => ({ id: String(option.value), label: option.label }))}
      placeholder={placeholder}
      noMatch={NO_MATCH}
      anchor={anchor}
      disabled={busy || Boolean(restBusy)}
      onPick={(id) => {
        const next = parse(id);
        if (next !== undefined) run(next);
      }}
    />
  );
}
