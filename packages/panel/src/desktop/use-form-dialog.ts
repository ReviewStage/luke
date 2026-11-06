import type { DialogAct, DialogConfirm } from "@repo/ui";
import {
  CONFIRM_STAGE,
  type ConfirmRejection,
  confirmAsked,
  confirmWithdrawable,
} from "@repo/ui/confirm-state";
import { useState } from "react";

interface FormDialog {
  open: boolean;
  settling: boolean;
  refusal: ConfirmRejection | undefined;
  dismiss: () => void;
  submit: () => void;
  act: Pick<DialogAct, "onPress" | "busy" | "disabled" | "landed" | "onShown">;
}

export function useFormDialog(confirm: DialogConfirm, valid: boolean): FormDialog {
  const { stage, rejection } = confirm;
  const acting = stage === CONFIRM_STAGE.ACTING;
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
      disabled: !valid && !settling,
      landed,
      onShown: () => setLanded(false),
    },
  };
}
