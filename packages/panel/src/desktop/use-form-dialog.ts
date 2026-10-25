import type { DialogAct, DialogConfirm } from "@luke/ui";
import { CONFIRM_STAGE, confirmAsked, confirmWithdrawable } from "@luke/ui/confirm-state";
import { useState } from "react";

/**
 * use-form-dialog.ts -- what a dialog that asks for input holds beyond its confirm: whether it stands, how it is put away, and the foot's answers.
 *
 * A form is a `Dialog` with its fields and `DialogActions` as its foot, never
 * a `ConfirmDialog`, which only asks yes or no of an act. Its question is
 * still held by `useConfirmDialog`, so it goes with its subject and its
 * surface, and its answer still runs through the confirm, so a refusal
 * stands in the card saying why while the fields keep what was typed. This
 * is the rest: the card stands while the question is asked, running, or
 * refused, and for the beat the act's check shows once it lands; Escape and
 * Cancel put it away unless the answer is under way; the act stands
 * unavailable until the form is valid, and Enter in a field answers it
 * as a press of the act would, never before.
 */

/** What a form's owner draws its card and foot from. */
interface FormDialog {
  /** Whether the card stands. */
  open: boolean;
  /** Whether the answer is under way or its check is showing, which stills the card. */
  settling: boolean;
  /** Why the last answer was refused, while no other is under way. */
  refusal: string | undefined;
  /** Escape and Cancel: puts the question away, unless it has been answered. */
  dismiss: () => void;
  /** Enter in a field: answers where the form is valid. */
  submit: () => void;
  /** What the act's button is told, to be spread into `DialogActions`' `act`. */
  act: Pick<DialogAct, "onPress" | "busy" | "disabled" | "landed" | "onShown">;
}

/** One form's dialog, held over its confirm: `valid` is whether the act may be pressed. */
export function useFormDialog(confirm: DialogConfirm, valid: boolean): FormDialog {
  const { stage, rejection } = confirm;
  const acting = stage === CONFIRM_STAGE.ACTING;
  // Note that an act landing is noticed in the render that sees it leave
  // its run with no refusal, because a card closed an effect later would
  // draw one frame with nothing there before its check.
  const [wasActing, setWasActing] = useState(acting);
  const [landed, setLanded] = useState(false);
  if (acting !== wasActing) {
    setWasActing(acting);
    setLanded(!acting && rejection === undefined && confirm.standing);
  }
  if (landed && !confirm.standing) setLanded(false);
  const settling = acting || landed;

  const submit = () => {
    if (!valid || settling) return;
    confirm.run();
  };
  return {
    open: confirm.standing && (confirmAsked(stage) || rejection !== undefined || landed),
    settling,
    refusal: acting ? undefined : rejection,
    dismiss: () => {
      if (settling) return;
      if (confirmWithdrawable(stage)) confirm.keep();
      confirm.clear();
    },
    submit,
    act: {
      onPress: submit,
      busy: acting,
      // Note that a landed act keeps its words, though the form it came from is empty again.
      disabled: !valid && !settling,
      landed,
      onShown: () => setLanded(false),
    },
  };
}
