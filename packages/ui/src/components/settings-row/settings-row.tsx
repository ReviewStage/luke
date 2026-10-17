import { type ReactNode, useId } from "react";

/**
 * settings-row.tsx -- one setting on a line: its name and what it does on the left, the control that sets it at the end, and what went wrong with its last write under both.
 *
 * The row mints the ids and hands its controls what they need to be read
 * with its words: the label's id, for a control named by `aria-labelledby`,
 * and the description and the error, which describe it. The error stands in
 * a polite live region from the first render, empty until it says
 * something, as a form field's does. The row is its own inline-size
 * container, so where its controls stand is decided by the row's width and
 * not the window's: under 380px they drop below the words to the row's end.
 * The row owns its padding, the least height its profile gives a row (the
 * window's rows stand even whether or not they carry a description), and the
 * room between its parts; its edges and the rules between rows are its
 * section's.
 *
 * A row that stands for someone or something of its own, an account or a
 * provider, leads with its face or mark (`leading`), centred before its
 * words. The mark stays beside the words when the controls drop below them,
 * and names nothing: the label alone names the row's control.
 *
 * A compact row (`SETTINGS_ROW_DENSITY.COMPACT`) stands bare, without
 * padding and at a menu row's least height, where the surface around it, a
 * popover, already insets it. Unlike a card's row it does not stack under
 * 380px: a popover is narrower than that throughout, so its controls stay
 * beside its words and wrap below them only where they cannot fit at all.
 */

/** How a row stands: padded in a section's card, or bare inside a surface that insets it. */
export const SETTINGS_ROW_DENSITY = {
  CARD: "card",
  COMPACT: "compact",
} as const;

export type SettingsRowDensity = (typeof SETTINGS_ROW_DENSITY)[keyof typeof SETTINGS_ROW_DENSITY];

/** What a row hands the controls it holds. */
export interface SettingsRowControl {
  /** The label's id, for a control named by `aria-labelledby`. */
  readonly labelId: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
}

/** Whether a row's words say anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** A setting named `label`, described by `description`, set by `children`, and failed by `error` while it says something. */
export function SettingsRow({
  label,
  description,
  error,
  leading,
  density = SETTINGS_ROW_DENSITY.CARD,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** The face or mark the row leads with, before its words, where it stands for something of its own. */
  leading?: ReactNode;
  /** What went wrong with the last write, or nothing while none did. */
  error?: ReactNode;
  /** How the row stands; in a section's card where none is named. */
  density?: SettingsRowDensity | undefined;
  /** The row's controls, handed the row's ids to name and describe them by. */
  children: (control: SettingsRowControl) => ReactNode;
}): React.JSX.Element {
  const id = useId();
  const labelId = `${id}label`;
  const descriptionId = `${id}description`;
  const errorId = `${id}error`;
  const failed = said(error);
  const described = said(description);
  const describedBy = [described ? descriptionId : undefined, failed ? errorId : undefined]
    .filter((part) => part !== undefined)
    .join(" ");
  return (
    <div className="luke-settings-row" data-invalid={failed} data-density={density}>
      <div className="luke-settings-row-body">
        <div className="luke-settings-row-line">
          <div className="luke-settings-row-subject">
            {said(leading) ? <div className="luke-settings-row-leading">{leading}</div> : null}
            <div className="luke-settings-row-copy">
              <span className="luke-settings-row-label" id={labelId}>
                {label}
              </span>
              {described ? (
                <p className="luke-settings-row-description" id={descriptionId}>
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          <div className="luke-settings-row-controls">
            {children({
              labelId,
              "aria-describedby": describedBy === "" ? undefined : describedBy,
              "aria-invalid": failed ? true : undefined,
            })}
          </div>
        </div>
        <p className="luke-settings-row-error" id={errorId} aria-live="polite">
          {failed ? error : null}
        </p>
      </div>
    </div>
  );
}
