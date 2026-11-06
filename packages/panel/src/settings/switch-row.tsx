import { searchAnchorProps } from "@repo/settings/settings-anchors";
import { SettingsRow, type SettingsRowDensity, Switch } from "@repo/ui";
import { ReplayWords } from "@repo/ui/session-replay-marks";
import { useEffect } from "react";
import { SettingMarks } from "./marks.js";
import type { RowChange } from "./row-write.js";

export function SwitchRow({
  label,
  labelReplayUnmasked = false,
  detail,
  checked,
  anchor,
  changed,
  disabled,
  density,
  write,
  onChange,
}: RowChange<boolean> & {
  label: string;
  labelReplayUnmasked?: boolean | undefined;
  detail?: React.ReactNode;
  checked: boolean;
  anchor?: string;
  changed?: boolean;
  disabled?: boolean;
  density?: SettingsRowDensity | undefined;
}): React.JSX.Element {
  const ahead = write?.ahead;
  const agreed = write !== undefined && !write.busy && ahead?.value === checked;
  useEffect(() => {
    if (agreed) write.settle();
  }, [agreed, write]);
  const run = write === undefined ? onChange : write.run;
  return (
    <SettingsRow
      label={<ReplayWords unmasked={labelReplayUnmasked}>{label}</ReplayWords>}
      adornment={<SettingMarks changed={changed} saves={write?.savedAt ?? 0} />}
      description={detail}
      density={density}
      labelsControl
    >
      {(control) => (
        <Switch
          id={control.controlId}
          {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
          checked={ahead === undefined ? checked : ahead.value}
          label={label}
          describedBy={control["aria-describedby"]}
          aria-invalid={control["aria-invalid"]}
          disabled={disabled}
          onChange={(next) => run(next)}
        />
      )}
    </SettingsRow>
  );
}
