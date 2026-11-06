import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isComposingKey } from "../../composing-key.js";
import {
  CONFIRM_STAGE,
  type ConfirmAct,
  type ConfirmFailure,
  type ConfirmSurroundings,
  confirmAsked,
  confirmWithdrawable,
  type HeldConfirm,
  useConfirm,
} from "../../confirm-state.js";
import { ReplayMask, ReplayWords } from "../../session-replay-marks.js";
import { DIALOG_ROLE, Dialog, type RestoreTo } from "../dialog/dialog.js";
import { DIALOG_TONE, DialogActions, type DialogTone } from "../dialog/dialog-actions.js";
import { DIALOG_ANSWERS, DialogReplayUnmasked, useDialogFoot } from "../dialog/dialog-foot.js";
import { ErrorLine } from "../error-line/error-line.js";
import { FormField } from "../form-field/form-field.js";
import { TEXT_VARIANT, Text } from "../text/text.js";
import { TEXT_FIELD_AUTO_COMPLETE, TextField } from "../text-field/text-field.js";

export const CONFIRM_LOSS = {
  IRREVERSIBLE: "irreversible",
  AFFECTS_OTHERS: "affects-others",
} as const;

export type ConfirmLoss = (typeof CONFIRM_LOSS)[keyof typeof CONFIRM_LOSS];

const LOSS_TONE = {
  [CONFIRM_LOSS.IRREVERSIBLE]: DIALOG_TONE.DANGER,
  [CONFIRM_LOSS.AFFECTS_OTHERS]: DIALOG_TONE.PRIMARY,
} as const satisfies Record<ConfirmLoss, DialogTone>;

export interface DialogQuestion {
  title: string;
  body?: string;
  verb: string;
  running: string;
  loss: ConfirmLoss;
  replayUnmasked?: boolean | undefined;
  titleReplayMasked?: boolean | undefined;
  bodyReplayMasked?: boolean | undefined;
}

export interface DialogConfirm extends HeldConfirm {
  standing: boolean;
}

export function useConfirmDialog(
  surroundings: ConfirmSurroundings,
  act: ConfirmAct,
  failure: ConfirmFailure,
): DialogConfirm {
  const held = useConfirm(surroundings, act, failure);
  const standing = surroundings.subject && surroundings.surfaceOpen;
  if (!standing && held.rejection !== undefined && held.stage !== CONFIRM_STAGE.ACTING) {
    held.forget();
  }
  return useMemo(() => ({ ...held, standing }), [held, standing]);
}

const BODY = "m-0 text-body text-muted-foreground wrap-anywhere";
const GATE = "font-mono text-foreground wrap-anywhere";

interface ActState {
  acting: boolean;
  landed: boolean;
  onShown: () => void;
}

function ConfirmCard({
  open,
  confirm,
  question,
  field,
  gate,
  restoreTo,
  act,
  children,
}: {
  open: boolean;
  confirm: DialogConfirm;
  question: DialogQuestion;
  field: React.RefObject<HTMLInputElement | null> | undefined;
  gate: string | undefined;
  restoreTo: RestoreTo | undefined;
  act: ActState;
  children: React.ReactNode;
}): React.JSX.Element {
  const { stage, rejection } = confirm;
  const { acting, landed } = act;
  const settling = acting || landed;
  const cancel = useRef<HTMLButtonElement | null>(null);
  const actButton = useRef<HTMLButtonElement | null>(null);
  const gateField = useRef<HTMLInputElement | null>(null);
  const [typed, setTyped] = useState("");
  const bodyId = useId();
  const locked = gate !== undefined && typed !== gate;

  const dismiss = () => {
    if (settling) return;
    if (confirmWithdrawable(stage)) confirm.keep();
    confirm.clear();
  };
  const fieldKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || settling || isComposingKey(event)) return;
    if (event.target !== field?.current && event.target !== gateField.current) return;
    event.preventDefault();
    actButton.current?.click();
  };

  return (
    <Dialog
      open={open}
      role={DIALOG_ROLE.ALERT_DIALOG}
      title={question.title}
      describedBy={question.body ? bodyId : undefined}
      replayUnmasked={question.replayUnmasked}
      titleReplayMasked={question.titleReplayMasked}
      busy={settling}
      refused={rejection !== undefined && !acting}
      initialFocus={field ?? (gate === undefined ? cancel : gateField)}
      onDismiss={dismiss}
      restoreTo={restoreTo}
      onKeyDown={fieldKey}
      actions={
        <DialogActions
          onCancel={dismiss}
          cancelRef={cancel}
          act={{
            verb: question.verb,
            tone: LOSS_TONE[question.loss],
            onPress: () => confirm.run(),
            running: question.running,
            busy: acting,
            disabled: locked,
            focusableWhenDisabled: locked,
            landed,
            onShown: act.onShown,
            ref: actButton,
          }}
        />
      }
    >
      {question.body ? (
        <p id={bodyId} className={BODY}>
          <ReplayWords masked={question.bodyReplayMasked}>{question.body}</ReplayWords>
        </p>
      ) : null}
      <ReplayMask>{children}</ReplayMask>
      {gate === undefined ? null : (
        <FormField
          label={
            <>
              Type{" "}
              <span className={GATE}>
                <ReplayMask>{gate}</ReplayMask>
              </span>{" "}
              to confirm
            </>
          }
        >
          {(control) => (
            <TextField
              ref={gateField}
              field={control}
              value={typed}
              onChange={setTyped}
              disabled={settling}
              spellCheck={false}
              autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
            />
          )}
        </FormField>
      )}
      <ReplayMask>
        <ErrorLine error={rejection !== undefined && !acting ? rejection : undefined} />
      </ReplayMask>
    </Dialog>
  );
}

interface AnswerState extends ActState {
  shown: boolean;
  openings: number;
}

function useAnswerState(confirm: DialogConfirm): AnswerState {
  const { stage, rejection } = confirm;
  const acting = stage === CONFIRM_STAGE.ACTING;
  const [wasStage, setWasStage] = useState(stage);
  const [landed, setLanded] = useState(false);
  const [seen, setSeen] = useState(false);
  const [openings, setOpenings] = useState(0);
  if (stage !== wasStage) {
    setWasStage(stage);
    setLanded(wasStage === CONFIRM_STAGE.ACTING && rejection === undefined && confirm.standing);
    setSeen(false);
    if (wasStage === CONFIRM_STAGE.RESTING) setOpenings((count) => count + 1);
  }
  if (landed && !confirm.standing) setLanded(false);
  const shown =
    confirm.standing && (confirmAsked(stage) || rejection !== undefined || (landed && !seen));
  return { acting, landed, onShown: () => setSeen(true), shown, openings };
}

export function ConfirmDialog({
  open,
  confirm,
  question,
  field,
  gate,
  restoreTo,
  children,
}: {
  open: boolean;
  confirm: DialogConfirm;
  question: DialogQuestion;
  field?: React.RefObject<HTMLInputElement | null> | undefined;
  gate?: string | undefined;
  restoreTo?: RestoreTo | undefined;
  children?: React.ReactNode;
}): React.JSX.Element {
  const answer = useAnswerState(confirm);
  return (
    <ConfirmCard
      key={answer.openings}
      open={open && answer.shown}
      confirm={confirm}
      question={question}
      field={field}
      gate={gate}
      restoreTo={restoreTo}
      act={answer}
    >
      {children}
    </ConfirmCard>
  );
}

const FOOT_QUESTION = "flex min-w-0 flex-1 items-center gap-dialog-action-gap";
const FOOT_WORDS = "flex min-w-0 flex-1 flex-col";

export function FootQuestion({
  confirm,
  question,
}: {
  confirm: DialogConfirm;
  question: DialogQuestion;
}): React.JSX.Element | null {
  const foot = useDialogFoot();
  const answer = useAnswerState(confirm);
  const { acting, landed } = answer;
  const settling = acting || landed;
  const refused = confirm.rejection !== undefined && !acting;
  const cancel = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const withdraw = (): boolean => {
    if (settling) return false;
    if (confirmWithdrawable(confirm.stage)) confirm.keep();
    confirm.clear();
    return true;
  };
  const newestWithdraw = useRef(withdraw);
  newestWithdraw.current = withdraw;
  const shown = answer.shown && foot !== undefined;
  useLayoutEffect(() => {
    if (!shown || foot === undefined) return;
    return foot.claim({
      withdraw: () => newestWithdraw.current(),
      focus: cancel,
      busy: settling,
      refused,
    });
  }, [shown, foot, settling, refused]);

  if (!shown || foot?.slot == null) return null;
  return createPortal(
    // biome-ignore lint/a11y/useSemanticElements: a question is its words and its two answers, not a form's fields, so it is no `<fieldset>`.
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={question.body ? bodyId : undefined}
      className={FOOT_QUESTION}
    >
      <div className={FOOT_WORDS}>
        <Text id={titleId} variant={TEXT_VARIANT.LABEL}>
          <ReplayWords
            unmasked={question.replayUnmasked === true}
            masked={question.titleReplayMasked}
          >
            {question.title}
          </ReplayWords>
        </Text>
        {question.body ? (
          <p id={bodyId} className={BODY}>
            <ReplayWords
              unmasked={question.replayUnmasked === true}
              masked={question.bodyReplayMasked}
            >
              {question.body}
            </ReplayWords>
          </p>
        ) : null}
        <ErrorLine error={refused ? confirm.rejection : undefined} />
      </div>
      <div className={DIALOG_ANSWERS}>
        <DialogReplayUnmasked.Provider value={question.replayUnmasked === true}>
          <DialogActions
            onCancel={withdraw}
            cancelRef={cancel}
            act={{
              verb: question.verb,
              tone: LOSS_TONE[question.loss],
              onPress: () => confirm.run(),
              running: question.running,
              busy: acting,
              landed,
              onShown: answer.onShown,
            }}
          />
        </DialogReplayUnmasked.Provider>
      </div>
    </div>,
    foot.slot,
  );
}
