import { type ReactNode, useState } from "react";
import { IconButton } from "../button/button.js";
import {
  DISCLOSURE_BODY,
  DisclosureBody,
  DisclosureChevron,
  DisclosureScope,
  useDisclosureFold,
} from "../disclosure/disclosure.js";
import { OneLine } from "../one-line/one-line.js";
import {
  SettingsRow,
  SettingsRowActSlot,
  type SettingsRowControl,
  type SettingsRowIndent,
} from "./settings-row.js";

/**
 * settings-row-fold.tsx -- a settings row that folds open what it owns under its words, a line each, as a GitHub account its repositories.
 *
 * The row is `SettingsRow` as it stands, its chevron last at its end, a
 * quiet `IconButton` after any ⋯ the row holds, so every fold row's chevron
 * stands in one column, which turns as the fold opens and
 * says whether it is open in `aria-expanded`. The fold
 * stands in the row's own `below`, inside the row's rule and inset to its
 * words, so what it holds reads as part of the row rather than a box of its
 * own in the card. It opens and closes on the disclosure's motion
 * (`useDisclosureFold`): a press unrolls the body and fades it in, a close
 * fades it out first, and reduced motion holds it still at the tokens; a
 * fold drawn open from the start replays nothing.
 *
 * Its lines (`SettingsFoldLine`) are the row's description's type and tone,
 * the muted caption, each a name alone, starting where the row's words do
 * and held to one line as a row's name is (`OneLine`); a press at the foot,
 * such as Show all, stands on a line of its own (`SettingsFoldFoot`).
 *
 * A row that owns whole rows rather than lines, as an integration its
 * accounts or channels, folds them with `SettingsRowsFold`: the same
 * chevron last at the head row's end, and the rows drawn after it while the
 * fold is open, each a row of the card in its own right, ruled as the
 * card's own.
 */

/**
 * A row named `label` that folds `children` open under its words, its
 * chevron named `foldLabel`, open at first where `defaultOpen` says, and
 * the row's other controls, such as its ⋯, before the chevron at its end.
 */
export function SettingsFoldRow({
  label,
  description,
  leading,
  indent,
  foldLabel,
  defaultOpen = false,
  actions,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** The face or mark the row leads with, past which the fold's lines start. */
  leading?: ReactNode;
  indent?: SettingsRowIndent | undefined;
  /** The chevron's name, which a sighted reader has from the row ("Repositories of acme"). */
  foldLabel: string;
  defaultOpen?: boolean | undefined;
  /** The row's other controls, handed its ids, standing before the chevron. */
  actions?: ((control: SettingsRowControl) => ReactNode) | undefined;
  /** The fold's lines. */
  children: ReactNode;
}): React.JSX.Element {
  const { state, details } = useDisclosureFold(defaultOpen);
  return (
    <DisclosureScope state={state}>
      <SettingsRow
        label={label}
        description={description}
        leading={leading}
        indent={indent}
        below={
          state.drawn
            ? () => (
                <div
                  className="ui-settings-row-fold min-w-0"
                  data-disclosure={details["data-disclosure"]}
                >
                  <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
                    <ul className="ui-settings-row-fold-lines m-0 flex list-none flex-col gap-ui-4 p-0">
                      {children}
                    </ul>
                  </DisclosureBody>
                </div>
              )
            : undefined
        }
      >
        {(control) => (
          <>
            {actions?.(control)}
            <IconButton
              icon={<DisclosureChevron />}
              label={foldLabel}
              aria-expanded={state.open}
              onClick={state.toggle}
            />
          </>
        )}
      </SettingsRow>
    </DisclosureScope>
  );
}

/**
 * A head row and the rows it owns under it, closed until its chevron is
 * pressed: `head` draws the row, handed the chevron (named `label`) to
 * stand last at its end, or, where there are no `rows` to fold, the
 * chevron's room alone, so the controls of every row in the card end in one
 * column whether it folds or not.
 */
export function SettingsRowsFold({
  label,
  head,
  rows,
}: {
  /** The chevron's name, which a sighted reader has from the head row ("GitHub's accounts"). */
  label: string;
  /** The head row, handed the chevron to draw after its other controls. */
  head: (chevron: ReactNode) => ReactNode;
  /** The rows the fold owns, or nothing where it owns none now. */
  rows?: ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const folds = rows !== undefined && rows !== null && rows !== false;
  return (
    <>
      {head(
        folds ? (
          <IconButton
            icon={<DisclosureChevron open={open} />}
            label={label}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          />
        ) : (
          <SettingsRowActSlot />
        ),
      )}
      {folds && open ? rows : null}
    </>
  );
}

/** The type and tone of every line of a fold: the row description's muted caption. */
const LINE =
  "ui-settings-fold-line flex min-w-0 items-center font-sans text-caption font-caption text-muted-foreground";

/** One line of a fold: its words on one line, read whole in the window's tooltip while they are cut short. */
export function SettingsFoldLine({ children }: { children: string }): React.JSX.Element {
  return (
    <li className={LINE}>
      <OneLine>{children}</OneLine>
    </li>
  );
}

/** The foot of a fold's lines: the press that shows the rest, such as Show all, on a line of its own. */
export function SettingsFoldFoot({ children }: { children: ReactNode }): React.JSX.Element {
  return <li className={LINE}>{children}</li>;
}
