import { useSettingWrite } from "@luke/ui/use-setting-write";
import type { ActionResult } from "@luke/wire";
import { useId } from "react";
import { ChangedMark } from "./marks";
import { PickerRow } from "./picker-row";

/** What the menu says when a search over a short fixed set matches nothing, which it has no search to say. */
const NO_MATCH = "Nothing matches.";

/**
 * An option's picture, or an empty disc of the same size where a set whose
 * other options have pictures leaves this one without, so every label in the
 * menu starts at one edge. The picture says nothing the label does not, so it
 * is hidden from a reader, and no referrer is sent with its fetch.
 */
function OptionPicture({ src }: { src: string | undefined }): React.JSX.Element {
  if (src === undefined) return <span className="settings-option-picture" aria-hidden="true" />;
  return (
    <img
      className="settings-option-picture"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

/**
 * A settings pop-up: its name, optional why, and one value from a small fixed
 * set, picked from the app's own menu with no search, since a set this short
 * is read whole. The visible name names the chip and the why describes it.
 */
export function SelectRow<Value extends string | number>({
  label,
  detail,
  value,
  options,
  parse,
  anchor,
  changed,
  busy: restBusy,
  onChange,
}: {
  label: string;
  detail?: string | undefined;
  value: Value;
  /** Each option's token and words, and the address of its picture where the set has faces. */
  options: readonly { value: Value; label: string; picture?: string | undefined }[];
  parse: (raw: string) => Value | undefined;
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
  const pictured = options.some((option) => option.picture !== undefined);
  const detailId = useId();
  return (
    <>
      <PickerRow
        label={label}
        copy={
          <>
            <strong>
              {label}
              {changed ? <ChangedMark /> : null}
            </strong>
            {detail ? <small id={detailId}>{detail}</small> : null}
          </>
        }
        describedBy={detail ? detailId : undefined}
        value={String(value)}
        valueLabel={chosen?.label ?? String(value)}
        valueIcon={pictured ? <OptionPicture src={chosen?.picture} /> : undefined}
        rows={options.map((option) => ({
          id: String(option.value),
          label: option.label,
          ...(pictured ? { icon: <OptionPicture src={option.picture} /> } : undefined),
        }))}
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
