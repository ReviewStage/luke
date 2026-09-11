import { PopUpIcon } from "@sidecar/panel";
import type { ActionResult } from "@sidecar/wire";
import { ACT_KIND } from "#shared/messages/acts";
import { tell } from "../act";
import { type ErrandTarget, errandTargetProps } from "../luke-errand";
import { searchAnchorProps } from "../settings-anchors";
import { ChangedMark } from "./marks";
import { useSettingWrite } from "./use-setting-write";

/**
 * A settings pop-up: its name, optional why, and one value from a small fixed
 * set. The closed face is drawn here and the open menu is the system's, which
 * is also why the window is focused before the menu opens — a menu opened
 * while the panel is showing without being key would drop its first choice.
 * The up-and-down badge is the macOS mark for that kind of button; the select
 * alone answers the pointer.
 */
export function SelectRow<Value extends string | number>({
  label,
  detail,
  value,
  options,
  parse,
  ariaLabel,
  errand,
  anchor,
  changed,
  busy: restBusy,
  onChange,
}: {
  label: string;
  detail?: string | undefined;
  value: Value;
  options: readonly { value: Value; label: string }[];
  parse: (raw: string) => Value | undefined;
  /** When the visible name is too short to stand as the control's own name. */
  ariaLabel?: string;
  /**
   * The id a spoken change names this pop-up by. Marked on the `select`
   * rather than the box positioning it: an errand outlines what it lands on,
   * and only the `select` is drawn with the corners that outline has to take.
   */
  errand?: ErrandTarget;
  /**
   * The id a pressed search result lands on, for a row whose control carries
   * no errand mark of its own. Marked on the row rather than the `select`,
   * because the landing scrolls to the whole line rather than outlining it.
   */
  anchor?: string;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean;
  /**
   * A sibling write in flight. Two pop-ups that store one setting share a
   * rest so one save cannot finish behind the other.
   */
  busy?: boolean;
  // biome-ignore lint/suspicious/noConfusingVoidType: the voice and pace cannot be refused, so those writes answer void
  onChange: (value: Value) => void | Promise<ActionResult>;
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
        <span className="voice-select">
          <select
            {...(errand ? errandTargetProps(errand) : undefined)}
            aria-label={ariaLabel ?? label}
            value={value}
            disabled={busy || Boolean(restBusy)}
            onChange={(event) => {
              const next = parse(event.target.value);
              if (next !== undefined) run(next);
            }}
            onFocus={() => {
              // The panel can be showing without its window being key, and a
              // menu opened then would drop its first choice.
              tell(ACT_KIND.WINDOW_FOCUS_PANEL);
            }}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {/* Drawn over the select, the way macOS badges a pop-up button; the
              select alone answers the pointer. */}
          <span className="voice-select-badge" aria-hidden="true">
            <PopUpIcon />
          </span>
        </span>
      </div>
      {rejection ? (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      ) : null}
    </>
  );
}
