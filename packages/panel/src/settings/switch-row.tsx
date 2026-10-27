import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { SettingsRow, type SettingsRowDensity, STATUS_TONE, Switch } from "@luke/ui";
import { useOptimisticSettingWrite } from "@luke/ui/use-setting-write";
import type { ActionResult } from "@luke/wire";
import { showToast, TOAST_HOLD } from "../toast.js";
import { SettingMarks } from "./marks.js";

/**
 * A settings switch: `@luke/ui`'s `SettingsRow` holding its `Switch`, the
 * row's name, optional why, and the thumb. The visible name is the switch's
 * own name and the why is its description, so a reader hears the words a
 * sighted hand clicks. The switch flips at once, from a local value, and the
 * write lives here, so two switches can be in flight at once; a write the
 * store refuses puts the switch back and says why in a FAILED toast, and the
 * switch never rests disabled for a write (Dean, 2026-10-23).
 */
export function SwitchRow({
  label,
  detail,
  checked,
  anchor,
  changed,
  disabled,
  density,
  onChange,
}: {
  label: string;
  /** The why under the name: words, and where a row needs one, a link among them. */
  detail?: React.ReactNode;
  checked: boolean;
  /** The id a pressed search result lands on: marked on the switch itself, which then takes the keyboard. */
  anchor?: string;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean;
  /** Whether the switch rests for a reason of its caller's; a write in flight never rests it. */
  disabled?: boolean;
  /** How the row stands; in a settings card where none is named. */
  density?: SettingsRowDensity | undefined;
  /** The write, or nothing to wait on where the switch only changes a draft. */
  // biome-ignore lint/suspicious/noConfusingVoidType: a draft's switch cannot be refused, so its change answers void
  onChange: (enabled: boolean) => void | Promise<ActionResult>;
}): React.JSX.Element {
  const { value, saves, run } = useOptimisticSettingWrite(checked, onChange, (words) =>
    showToast({ words, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED }),
  );
  return (
    <SettingsRow
      label={label}
      adornment={<SettingMarks changed={changed} saves={saves} />}
      description={detail}
      density={density}
      labelsControl
    >
      {(control) => (
        <Switch
          id={control.controlId}
          {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
          checked={value}
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
