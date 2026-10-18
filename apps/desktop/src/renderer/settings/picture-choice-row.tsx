/**
 * picture-choice-row.tsx -- a settings choice whose every value has a face, chosen from the faces themselves.
 *
 * A face is a person to tell apart, which a pop-up's row-sized picture is
 * too small for, so a set with faces stands open under its name: the chosen
 * one large, as the call will show it, beside every face with its name
 * under it. The faces are the platform's own radio group, each a hidden
 * radio inside the face that labels it, so Tab reaches the chosen face and
 * the arrows move the choice as any radio group's do; a press or an arrow
 * writes at once, as a pop-up's choice does. It is `@luke/ui`'s
 * `SettingsRow`, the faces standing in its `below` slot, so the row's words
 * name and describe the group and a refused write stands in its error line.
 * A search result lands on the row whole, as on any row of several
 * controls, so the ring it draws is seen and the name scrolls into view
 * above the faces.
 */

import { ChangedMark } from "@luke/panel/settings/marks";
import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { SettingsRow } from "@luke/ui";
import { useSettingWrite } from "@luke/ui/use-setting-write";
import type { ActionResult } from "@luke/wire";
import { useId } from "react";

/** Each face's token, its name, and the address of its picture. */
interface PictureChoiceOption<Value extends string> {
  value: Value;
  label: string;
  picture: string;
}

export function PictureChoiceRow<Value extends string>({
  label,
  detail,
  value,
  options,
  anchor,
  changed,
  onChange,
}: {
  label: string;
  detail?: string | undefined;
  value: Value;
  options: readonly PictureChoiceOption<Value>[];
  /** The id a pressed search result lands on: marked on the row whole, which it rings. */
  anchor?: string | undefined;
  /** Whether the stored value differs from the default, which earns the mark. */
  changed?: boolean;
  onChange: (value: Value) => Promise<ActionResult>;
}): React.JSX.Element {
  const { busy, rejection, run } = useSettingWrite(onChange);
  const group = useId();
  const chosen = options.find((option) => option.value === value) ?? options[0];

  // Note that the anchor wraps the shared row, which takes no attribute of its own, so the landing rings it whole.
  return (
    <div {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}>
      <SettingsRow
        label={
          <>
            {label}
            {changed ? <ChangedMark /> : null}
          </>
        }
        description={detail}
        error={rejection}
        below={(control) => (
          <div className="picture-choice">
            {chosen === undefined ? null : (
              // The chosen face again, large: the checked radio already says which it is.
              <div className="picture-choice-stage" aria-hidden="true">
                <img src={chosen.picture} alt="" draggable={false} />
                <span className="picture-choice-stage-name">{chosen.label}</span>
              </div>
            )}
            <fieldset
              className="picture-choice-faces"
              aria-labelledby={control.labelId}
              aria-describedby={control["aria-describedby"]}
              aria-invalid={control["aria-invalid"]}
              aria-busy={busy}
            >
              {options.map((option) => {
                const checked = option.value === chosen?.value;
                return (
                  <label key={option.value} className="picture-choice-face">
                    <input
                      type="radio"
                      className="visually-hidden"
                      name={group}
                      value={option.value}
                      checked={checked}
                      // Note that a write in flight rests the group without disabling it, so the radio the arrows reached keeps the keyboard.
                      onChange={() => {
                        if (!busy && !checked) run(option.value);
                      }}
                    />
                    <span className="picture-choice-photo">
                      <img src={option.picture} alt="" draggable={false} />
                    </span>
                    <span className="picture-choice-name">{option.label}</span>
                  </label>
                );
              })}
            </fieldset>
          </div>
        )}
      />
    </div>
  );
}
