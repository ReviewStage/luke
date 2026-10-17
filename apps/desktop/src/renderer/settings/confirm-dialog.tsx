import {
  CONFIRM_STAGE,
  type ConfirmSurroundings,
  confirmAsked,
  confirmWithdrawable,
  type HeldConfirm,
  useConfirm,
} from "@luke/ui/confirm-state";
import type { ActionResult } from "@luke/wire";
import { useId, useRef } from "react";
import { MODAL_ROLE, ModalShell } from "../modal-shell";
import { BusyLabel } from "../spinner";

/**
 * confirm-dialog.tsx -- an irreversible act's question as a modal over the window: what goes, then Cancel and the act.
 *
 * The desktop window asks the way every desktop app does: the window dims, a
 * card names what the act takes with it, and the two answers sit at its foot,
 * the safe one first and the act in red last, or in the accent for an act
 * that can be undone, such as restoring a version of a plan. Focus lands on Cancel, so a key
 * already pressed changes nothing; Tab stays inside the card; Escape, a press
 * on the dimmed window, and Cancel all withdraw it, and however it goes,
 * focus goes back to whatever asked if that still stands. Enter is the
 * focused button's own, so it acts only from the act's button.
 *
 * The question is `confirm-state.ts`'s, so it withdraws the render its subject
 * or its surface goes. An answer already given finishes where it stands with
 * both buttons stilled; one that was refused keeps the card up saying why, so
 * the act can be tried again or let go.
 */

/** How the act's button is drawn: red for an act that destroys, the accent for one that can be undone. */
export const DIALOG_TONE = {
  DANGER: "danger",
  PRIMARY: "primary",
} as const;

type DialogTone = (typeof DIALOG_TONE)[keyof typeof DIALOG_TONE];

/** The act's button's class, by its tone. */
const ACT_BUTTON_CLASS = {
  [DIALOG_TONE.DANGER]: "danger-button",
  [DIALOG_TONE.PRIMARY]: "primary-button",
} as const satisfies Record<DialogTone, string>;

/** What the dialog says: its title, what the act takes with it if anything needs saying, and the act's word, and what a reader is told while it runs, under the spinner; the act is red unless its tone says otherwise. */
export interface DialogQuestion {
  title: string;
  body?: string;
  verb: string;
  running: string;
  tone?: DialogTone;
}

/** One confirming act as a dialog holds it: the confirm, and whether its subject and surface still stand. */
export interface DialogConfirm extends HeldConfirm {
  standing: boolean;
}

/**
 * One confirming act held for a dialog. A refusal is drawn in the dialog
 * itself, so it is as much a question still standing as the ask was, and it
 * goes with its subject and its surface on the same terms: in the render that
 * finds either gone.
 */
export function useConfirmDialog(
  surroundings: ConfirmSurroundings,
  action: () => Promise<ActionResult>,
): DialogConfirm {
  const held = useConfirm(surroundings, action);
  const standing = surroundings.subject && surroundings.surfaceOpen;
  if (!standing && held.rejection !== undefined && held.stage !== CONFIRM_STAGE.ACTING) {
    held.clear();
  }
  return { ...held, standing };
}

/**
 * The question over the window while it is asked, running, or refused, and
 * nothing otherwise, in the window's one modal frame (`../modal-shell.tsx`).
 */
export function ConfirmDialog({
  confirm,
  question,
  field,
  children,
}: {
  confirm: DialogConfirm;
  question: DialogQuestion;
  /** A field the question asks to be filled, which takes focus in Cancel's place; Enter in it answers. */
  field?: React.RefObject<HTMLInputElement | null>;
  /** What the card holds under its body: the field, where the question asks one. */
  children?: React.ReactNode;
}): React.JSX.Element | null {
  const { stage, rejection } = confirm;
  // Note that an answer under way is hidden with its surface rather than
  // drawn over whatever stands in its place, because the window then
  // presents something else; the act itself finishes all the same.
  const open = confirm.standing && (confirmAsked(stage) || rejection !== undefined);
  const acting = stage === CONFIRM_STAGE.ACTING;
  const cancel = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  if (!open) return null;

  const dismiss = () => {
    if (acting) return;
    if (confirmWithdrawable(stage)) confirm.keep();
    confirm.clear();
  };
  // Enter in the question's field answers it, since the field has no second
  // line to begin; anywhere else Enter is the focused button's own.
  const fieldKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.target !== field?.current || acting) return;
    event.preventDefault();
    confirm.run();
  };

  return (
    <ModalShell
      role={MODAL_ROLE.ALERT_DIALOG}
      labelledBy={titleId}
      {...(question.body ? { describedBy: bodyId } : undefined)}
      busy={acting}
      initialFocus={field ?? cancel}
      onDismiss={dismiss}
      onKeyDown={fieldKey}
    >
      <h2 id={titleId} className="confirm-dialog-title">
        {question.title}
      </h2>
      {question.body ? (
        <p id={bodyId} className="confirm-dialog-body">
          {question.body}
        </p>
      ) : null}
      {children}
      {rejection !== undefined && !acting ? (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      ) : null}
      <div className="confirm-dialog-actions">
        <button
          type="button"
          ref={cancel}
          className="toolbar-button"
          disabled={acting}
          onClick={dismiss}
        >
          Cancel
        </button>
        <button
          type="button"
          className={ACT_BUTTON_CLASS[question.tone ?? DIALOG_TONE.DANGER]}
          disabled={acting}
          onClick={() => confirm.run()}
        >
          <BusyLabel busy={acting} label={question.running}>
            {question.verb}
          </BusyLabel>
        </button>
      </div>
    </ModalShell>
  );
}
