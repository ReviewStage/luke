import type { ChipWidth, SettingsRowDensity } from "@luke/ui";
import { useSettingWrite } from "@luke/ui/use-setting-write";
import type { ActionResult } from "@luke/wire";
import { ACTOR_SIZE, PictureMark } from "../actor-ref";
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
  width,
  error,
  onChange,
}: {
  label: string;
  detail?: string | undefined;
  value: Value;
  /** Each option's token and words, and the address of its picture where the set has faces. */
  options: readonly { value: Value; label: string; picture?: string | undefined }[];
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
  error?: string | undefined;
  // biome-ignore lint/suspicious/noConfusingVoidType: the voice and pace cannot be refused, so those writes answer void
  onChange: (value: Value) => void | Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChange);
  const chosen = options.find((option) => option.value === value);
  const pictured = options.some((option) => option.picture !== undefined);
  return (
    <PickerRow
      label={label}
      detail={detail}
      changed={changed}
      error={rejection ?? error}
      density={density}
      width={width}
      value={String(value)}
      valueLabel={chosen?.label ?? String(value)}
      valueIcon={
        pictured && chosen !== undefined ? (
          <PictureMark
            id={String(chosen.value)}
            name={chosen.label}
            pictureUrl={chosen.picture}
            size={ACTOR_SIZE.INLINE}
          />
        ) : undefined
      }
      rows={options.map((option) => ({
        id: String(option.value),
        label: option.label,
        // A set with faces draws one on every row, the window's own face, its letter where it has no picture.
        ...(pictured
          ? {
              icon: (
                <PictureMark
                  id={String(option.value)}
                  name={option.label}
                  pictureUrl={option.picture}
                  size={ACTOR_SIZE.ROW}
                />
              ),
            }
          : undefined),
      }))}
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
