import { useSettingWrite } from "@luke/ui/use-setting-write";
import type { ActionResult } from "@luke/wire";
import { useId } from "react";
import { Switch } from "../switch";
import { ChangedMark } from "./marks";

/**
 * A settings switch: its name, optional why, and the thumb. The visible name is
 * the switch's own name and the why is its description, so a reader hears the
 * words a sighted hand clicks. The write and the refusal live here, so two
 * switches can be in flight at once and a refusal names the row that asked.
 */
export function SwitchRow({
  label,
  detail,
  checked,
  anchor,
  changed,
  disabled,
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
  onChange: (enabled: boolean) => Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChange);
  const detailId = useId();
  return (
    <>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>
            {label}
            {changed ? <ChangedMark /> : null}
          </strong>
          {detail ? <small id={detailId}>{detail}</small> : null}
        </span>
        <Switch
          checked={checked}
          label={label}
          describedBy={detail ? detailId : undefined}
          anchor={anchor}
          disabled={busy || disabled}
          onChange={run}
        />
      </div>
      {rejection ? (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      ) : null}
    </>
  );
}
