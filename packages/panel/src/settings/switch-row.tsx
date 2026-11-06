import { searchAnchorProps } from "@repo/settings/settings-anchors";
import { SettingsRow, type SettingsRowDensity, Switch } from "@repo/ui";
import { ReplayWords } from "@repo/ui/session-replay-marks";
import { useEffect } from "react";
import { SettingMarks } from "./marks.js";
import type { RowChange } from "./row-write.js";

/**
 * A settings switch: `@repo/ui`'s `SettingsRow` holding its `Switch`, the
 * row's name, optional why, and the thumb. The visible name is the switch's
 * own name and the why is its description, so a reader hears the words a
 * sighted hand clicks. A switch that writes takes its caller's write
 * (`row-write.ts`) and flips at once, drawing the value its newest write
 * asks for, until the stored value agrees; a write the store refuses puts
 * the switch back, its caller saying why in a FAILED toast (`refusalToast`),
 * and the switch never rests disabled for a write (Dean, 2026-10-23). A
 * switch that only changes a draft takes a plain change. A switch the reader
 * may not change is locked, its why its tooltip.
 */
export function SwitchRow({
  label,
  labelReplayUnmasked = false,
  detail,
  checked,
  anchor,
  changed,
  disabled,
  locked,
  density,
  write,
  onChange,
}: RowChange<boolean> & {
  label: string;
  /** Whether its name is the app's own words, which a screen recording shows as they read; masked where none is named. */
  labelReplayUnmasked?: boolean | undefined;
  /** The why under the name: words, and where a row needs one, a link among them. */
  detail?: React.ReactNode;
  checked: boolean;
  /** The id a pressed search result lands on: marked on the switch itself, which then takes the keyboard. */
  anchor?: string;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean;
  /** Whether the switch rests for a reason of its caller's; a write in flight never rests it. */
  disabled?: boolean;
  /** Why the reader may not change it, where they may not, said as its tooltip (`Switch`'s `locked`). */
  locked?: string | undefined;
  /** How the row stands; in a settings card where none is named. */
  density?: SettingsRowDensity | undefined;
}): React.JSX.Element {
  const ahead = write?.ahead;
  const agreed = write !== undefined && !write.busy && ahead?.value === checked;
  // Note that a landed write is let go of once the stored value agrees, so the switch then follows the store again, other windows' changes included.
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
          locked={locked}
          onChange={(next) => run(next)}
        />
      )}
    </SettingsRow>
  );
}
