import { type Ref, useContext } from "react";
import { ReplayUnmask, ReplayWords } from "../../session-replay-marks.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { DialogReplayUnmasked } from "./dialog-foot.js";

export const DIALOG_TONE = {
  DANGER: "danger",
  PRIMARY: "primary",
} as const;

export type DialogTone = (typeof DIALOG_TONE)[keyof typeof DIALOG_TONE];

const ACT_VARIANT = {
  [DIALOG_TONE.DANGER]: BUTTON_VARIANT.DANGER,
  [DIALOG_TONE.PRIMARY]: BUTTON_VARIANT.PRIMARY,
} as const satisfies Record<DialogTone, string>;

const CANCEL = "Cancel";
const DONE = "Done";

export interface DialogAct {
  verb: string;
  tone: DialogTone;
  onPress: () => void;
  running: string;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  focusableWhenDisabled?: boolean | undefined;
  landed?: boolean | undefined;
  onShown?: (() => void) | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

export type DialogActionsProps =
  | {
      onCancel: () => void;
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

export function DialogActions(props: DialogActionsProps): React.JSX.Element {
  const unmasked = useContext(DialogReplayUnmasked);
  if (props.onDone !== undefined) {
    return (
      <Button variant={BUTTON_VARIANT.PRIMARY} onClick={props.onDone}>
        <ReplayUnmask>{DONE}</ReplayUnmask>
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
        <ReplayUnmask>{CANCEL}</ReplayUnmask>
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
        <ReplayWords unmasked={unmasked}>{act.verb}</ReplayWords>
      </Button>
    </>
  );
}
