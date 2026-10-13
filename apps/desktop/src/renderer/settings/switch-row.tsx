import type { ActionResult } from "@sidecar/wire";
import { useId } from "react";
import { searchAnchorProps } from "../settings-anchors";
import { ChangedMark } from "./marks";
import { useSettingWrite } from "./use-setting-write";

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
  onChange,
}: {
  label: string;
  detail?: string | undefined;
  checked: boolean;
  /** The id a pressed search result lands on: marked on the switch itself, which then takes the keyboard. */
  anchor?: string;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean;
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
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          aria-describedby={detail ? detailId : undefined}
          className="switch"
          {...(anchor ? searchAnchorProps(anchor) : undefined)}
          disabled={busy}
          onClick={() => run(!checked)}
        >
          <span className="switch-thumb" />
        </button>
      </div>
      {rejection ? (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      ) : null}
    </>
  );
}
