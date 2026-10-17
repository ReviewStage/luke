import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { SettingsRow, type SettingsRowDensity, Switch } from "@luke/ui";
import { useSettingWrite } from "@luke/ui/use-setting-write";
import type { ActionResult } from "@luke/wire";
import { ChangedMark } from "./marks";

/**
 * A settings switch: `@luke/ui`'s `SettingsRow` holding its `Switch`, the
 * row's name, optional why, and the thumb. The visible name is the switch's
 * own name and the why is its description, so a reader hears the words a
 * sighted hand clicks. The write and the refusal live here, so two switches
 * can be in flight at once and a refusal stands under the row that asked, in
 * the row's own error line.
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
  /** Whether the switch rests for a reason of its caller's, beside its own write in flight. */
  disabled?: boolean;
  /** How the row stands; in a settings card where none is named. */
  density?: SettingsRowDensity | undefined;
  /** The write, or nothing to wait on where the switch only changes a draft. */
  // biome-ignore lint/suspicious/noConfusingVoidType: a draft's switch cannot be refused, so its change answers void
  onChange: (enabled: boolean) => void | Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChange);
  return (
    <SettingsRow
      label={
        <>
          {label}
          {changed ? <ChangedMark /> : null}
        </>
      }
      description={detail}
      error={rejection}
      density={density}
    >
      {(control) => (
        <Switch
          {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
          checked={checked}
          label={label}
          describedBy={control["aria-describedby"]}
          aria-invalid={control["aria-invalid"]}
          disabled={busy || disabled}
          onChange={(next) => run(next)}
        />
      )}
    </SettingsRow>
  );
}
