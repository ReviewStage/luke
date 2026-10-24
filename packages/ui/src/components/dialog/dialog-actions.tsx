import type { Ref } from "react";
import { BUTTON_VARIANT, Button } from "../button/button.js";

/**
 * dialog-actions.tsx -- a dialog's foot, the one way its answers are drawn:
 * Cancel and then the act, or a single Done where the dialog only shows.
 *
 * It is what `Dialog`'s `actions` slot holds, so the foot lays them out at
 * its end at a common width. Cancel is quiet and comes first; the act comes
 * last, red for an act that destroys and in the accent otherwise, which its
 * owner says by its tone. While the act runs Cancel is stilled with it, and
 * the act names what it is doing; once it lands its check stands in the
 * act's words until it has been seen. A dialog that asks nothing, one that
 * shows a secret or a result, closes from its one Done in the accent.
 */

/** How the act is drawn: red for an act that destroys, the accent for one that does not. */
export const DIALOG_TONE = {
  DANGER: "danger",
  PRIMARY: "primary",
} as const;

export type DialogTone = (typeof DIALOG_TONE)[keyof typeof DIALOG_TONE];

/** The act's button's look, by its tone. */
const ACT_VARIANT = {
  [DIALOG_TONE.DANGER]: BUTTON_VARIANT.DANGER,
  [DIALOG_TONE.PRIMARY]: BUTTON_VARIANT.PRIMARY,
} as const satisfies Record<DialogTone, string>;

const CANCEL = "Cancel";
const DONE = "Done";

/** The act at the foot's end: its word, its tone, and where its answer stands. */
export interface DialogAct {
  verb: string;
  tone: DialogTone;
  onPress: () => void;
  /** What a reader is told while it runs ("Deleting"). */
  running: string;
  /** Whether its answer is under way, which stills Cancel too. */
  busy?: boolean | undefined;
  /** Whether it is unavailable, as one waiting on a field is. */
  disabled?: boolean | undefined;
  /** Whether it stays in the tab order while unavailable, so a press can be refused with its shake. */
  focusableWhenDisabled?: boolean | undefined;
  /** Whether it landed: its check stands in its words until it has been seen. */
  landed?: boolean | undefined;
  /** Heard once the check has been seen, as a dialog waits on it to close. */
  onShown?: (() => void) | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

/** What the foot is told: Cancel and the act, or the one Done. */
export type DialogActionsProps =
  | {
      onCancel: () => void;
      /** Cancel's button, where it takes focus as the card opens. */
      cancelRef?: Ref<HTMLButtonElement> | undefined;
      act: DialogAct;
      onDone?: undefined;
    }
  | {
      onDone: () => void;
      onCancel?: undefined;
      cancelRef?: undefined;
      act?: undefined;
    };

/** A dialog's answers at its foot: Cancel then the act, or Done alone. */
export function DialogActions(props: DialogActionsProps): React.JSX.Element {
  if (props.onDone !== undefined) {
    return (
      <Button variant={BUTTON_VARIANT.PRIMARY} onClick={props.onDone}>
        {DONE}
      </Button>
    );
  }
  const { act } = props;
  const settling = act.busy === true || act.landed === true;
  return (
    <>
      <Button
        ref={props.cancelRef}
        variant={BUTTON_VARIANT.QUIET}
        disabled={settling}
        onClick={props.onCancel}
      >
        {CANCEL}
      </Button>
      <Button
        ref={act.ref}
        variant={ACT_VARIANT[act.tone]}
        disabled={act.busy === true || act.disabled === true}
        focusableWhenDisabled={act.focusableWhenDisabled}
        busy={act.busy === true}
        busyLabel={act.running}
        done={act.landed}
        onDone={act.onShown}
        onClick={act.onPress}
      >
        {act.verb}
      </Button>
    </>
  );
}
