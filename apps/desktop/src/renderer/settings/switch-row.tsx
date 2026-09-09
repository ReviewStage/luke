import type { ActionResult } from "@sidecar/wire";
import { type ErrandTarget, errandTargetProps } from "../luke-errand";
import { ChangedMark } from "./marks";
import { useSettingWrite } from "./use-setting-write";

/**
 * A settings switch: its name, optional why, and the thumb. The write and the
 * refusal live here, so two switches can be in flight at once and a refusal
 * names the row that asked.
 */
export function SwitchRow({
  label,
  detail,
  checked,
  ariaLabel,
  errand,
  changed,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  /** When the visible name is too short to stand as the control's own name. */
  ariaLabel?: string;
  /** The id a spoken change names this switch by, so an errand lands on it. */
  errand?: ErrandTarget;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean;
  onChange: (enabled: boolean) => Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChange);
  return (
    <>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>
            {label}
            {changed ? <ChangedMark /> : null}
          </strong>
          {detail ? <small>{detail}</small> : null}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={ariaLabel ?? label}
          className="switch"
          {...(errand ? errandTargetProps(errand) : undefined)}
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
