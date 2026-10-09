import type { ActionResult } from "@sidecar/wire";
import { ChangedMark } from "./marks";
import { PickerRow } from "./picker-row";
import { useSettingWrite } from "./use-setting-write";

/** What the menu says when a search over a short fixed set matches nothing, which it has no search to say. */
const NO_MATCH = "Nothing matches.";

/**
 * A settings pop-up: its name, optional why, and one value from a small fixed
 * set, picked from the app's own menu with no search, since a set this short
 * is read whole.
 */
export function SelectRow<Value extends string | number>({
  label,
  detail,
  value,
  options,
  parse,
  ariaLabel,
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
  /** The id a pressed search result lands on: marked on the chip itself, which then takes the keyboard. */
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
  const chosen = options.find((option) => option.value === value);
  return (
    <>
      <PickerRow
        label={ariaLabel ?? label}
        copy={
          <>
            <strong>
              {label}
              {changed ? <ChangedMark /> : null}
            </strong>
            {detail ? <small>{detail}</small> : null}
          </>
        }
        value={String(value)}
        valueLabel={chosen?.label ?? String(value)}
        rows={options.map((option) => ({ id: String(option.value), label: option.label }))}
        noMatch={NO_MATCH}
        anchor={anchor}
        disabled={busy || Boolean(restBusy)}
        onPick={(id) => {
          const next = parse(id);
          if (next !== undefined) run(next);
        }}
      />
      {rejection ? (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      ) : null}
    </>
  );
}
