import type { ActionResult } from "@sidecar/wire";
import { searchAnchorProps } from "../settings-anchors";
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
  anchor,
  changed,
  onChange,
}: {
  label: string;
  detail?: string | undefined;
  checked: boolean;
  /** When the visible name is too short to stand as the control's own name. */
  ariaLabel?: string;
  /** The id a pressed search result lands on; marked on the row, since the landing scrolls to the whole line. */
  anchor?: string;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean;
  onChange: (enabled: boolean) => Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChange);
  return (
    <>
      <div className="settings-row" {...(anchor ? searchAnchorProps(anchor) : undefined)}>
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
