import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { ChipWidth, SettingsRowDensity } from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { refusalShown } from "../failure-report.js";
import { PickerRow } from "./picker-row.js";
import type { RowChange } from "./row-write.js";

const NO_MATCH = "No options match";

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
  labelReplayUnmasked?: boolean | undefined;
  detail?: string | undefined;
  value: Value;
  options: readonly {
    value: Value;
    label: string;
    faces?: React.ReactNode;
    disabled?: string | undefined;
  }[];
  parse: (raw: string) => Value | undefined;
  placeholder?: string | undefined;
  anchor?: string;
  changed?: boolean;
  busy?: boolean;
  density?: SettingsRowDensity | undefined;
  width?: ChipWidth | undefined;
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
