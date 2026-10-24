import type { ActionResult } from "@luke/wire";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isComposingKey } from "../../composing-key.js";
import {
  CONFIRM_STAGE,
  type ConfirmSurroundings,
  confirmAsked,
  confirmWithdrawable,
  type HeldConfirm,
  useConfirm,
} from "../../confirm-state.js";
import { DIALOG_ROLE, Dialog, type RestoreTo } from "../dialog/dialog.js";
import { DIALOG_TONE, DialogActions, type DialogTone } from "../dialog/dialog-actions.js";
import { DIALOG_ANSWERS, useDialogFoot } from "../dialog/dialog-foot.js";
import { ErrorLine } from "../error-line/error-line.js";
import { FormField } from "../form-field/form-field.js";
import { TEXT_VARIANT, Text } from "../text/text.js";
import { TEXT_FIELD_AUTO_COMPLETE, TextField } from "../text-field/text-field.js";

/**
 * confirm-dialog.tsx -- the question before an act that costs something, as a modal over the window or, asked inside a dialog, at that dialog's foot: what goes, then Cancel and the act.
 *
 * The window asks the way every desktop app does: it dims, a card names what
 * the act takes with it, and the two answers sit at its foot
 * (`DialogActions`), the safe one first and the act last. The act's colour
 * follows what it costs (`loss`): red only for what cannot be undone, and in
 * the accent for an act that can be undone but still asks because it reaches
 * someone else. Focus lands on Cancel, so a key already pressed changes
 * nothing; Tab stays inside the card; Escape, a press on the dimmed window,
 * and Cancel all withdraw it, and however it goes, focus goes back to
 * whatever asked if that still stands, or where its owner says once the act
 * took that away (`restoreTo`). Enter is the focused button's own, so
 * it acts only from the act's button.
 *
 * The question is `confirm-state.ts`'s, so it withdraws the render its subject
 * or its surface goes. However it goes, the card fades out on the exit token
 * as it stood, a landed act still wearing its check, rather than vanishing.
 * An answer already given finishes where it stands with
 * both buttons stilled; one that was refused keeps the card up saying why,
 * in the one `ErrorLine` every form part says what went wrong in, so the act
 * can be tried again or let go.
 */

/**
 * What an act that asks first costs, which decides its colour. An act that
 * can be undone and reaches no one else asks nothing: it happens at once and
 * offers Undo.
 */
export const CONFIRM_LOSS = {
  /** Past undoing: the act is red. */
  IRREVERSIBLE: "irreversible",
  /** Can be undone, but reaches someone else (removing a member, transferring ownership, disconnecting), so it still asks, in the accent. */
  AFFECTS_OTHERS: "affects-others",
  /** Can be undone and reaches only the asker, so it still asks, in the accent, until it happens at once and offers Undo. */
  REVERSIBLE: "reversible",
} as const;

export type ConfirmLoss = (typeof CONFIRM_LOSS)[keyof typeof CONFIRM_LOSS];

/** The act's tone, by what it costs. */
const LOSS_TONE = {
  [CONFIRM_LOSS.IRREVERSIBLE]: DIALOG_TONE.DANGER,
  [CONFIRM_LOSS.AFFECTS_OTHERS]: DIALOG_TONE.PRIMARY,
  [CONFIRM_LOSS.REVERSIBLE]: DIALOG_TONE.PRIMARY,
} as const satisfies Record<ConfirmLoss, DialogTone>;

/** What the dialog says: its title, what the act takes with it if anything needs saying, and the act's word, and what a reader is told while it runs. */
export interface DialogQuestion {
  title: string;
  body?: string;
  verb: string;
  running: string;
  /** What the act costs, which decides its colour: no question asks without saying it. */
  loss: ConfirmLoss;
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
  return useMemo(() => ({ ...held, standing }), [held, standing]);
}

/**
 * What the act takes with it, the name a gate asks for, and a refusal,
 * between the shared dialog's title and its answers, which hold them in the
 * middle that gives way and scrolls (`Dialog`), so the title and the answers
 * stay on screen however short the window is; the gate's name is set apart
 * from the words around it so it reads as exactly what to type.
 */
const BODY = "m-0 text-body text-muted-foreground wrap-anywhere";
const GATE = "font-mono text-foreground wrap-anywhere";

/** What the act's button is told by the stage of its answer. */
interface ActState {
  acting: boolean;
  /** The act landed, and its check is showing before the card goes. */
  landed: boolean;
  /** Heard once the check has been seen, which puts the card away. */
  onShown: () => void;
}

/**
 * The card itself, drawn afresh on each opening, so a gate's words start
 * empty every time it is asked, and kept through its fade as it closes.
 */
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
  // Note that the gate is matched exactly, case and spaces alike, because
  // its point is that the name was read, not that something like it was typed.
  const locked = gate !== undefined && typed !== gate;

  const dismiss = () => {
    if (settling) return;
    if (confirmWithdrawable(stage)) confirm.keep();
    confirm.clear();
  };
  // Enter in the question's field, or in its gate, answers it as a press of
  // the act would, which a gate still locked refuses with the act's own
  // shake; anywhere else Enter is the focused button's own. An Enter that
  // confirms an input method's composition is the input method's, not the act's.
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
          {question.body}
        </p>
      ) : null}
      {children}
      {gate === undefined ? null : (
        <FormField
          label={
            <>
              Type <span className={GATE}>{gate}</span> to confirm
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
      <ErrorLine>{rejection !== undefined && !acting ? rejection : null}</ErrorLine>
    </Dialog>
  );
}

/** Where a question's answer stands, as the card or the foot that asks it draws it. */
interface AnswerState extends ActState {
  /** Whether the question is drawn at all: asked, running, refused, or showing its check. */
  shown: boolean;
  /** How many times it has been asked, so each asking draws afresh. */
  openings: number;
}

/**
 * Where a question's answer stands: asked, running, refused, or landed and
 * showing its check until that has been seen.
 *
 * Note that an act landing is noticed in the render that sees it leave its
 * run with no refusal, because a question put away an effect later would
 * draw one frame with nothing there before its check.
 */
function useAnswerState(confirm: DialogConfirm): AnswerState {
  const { stage, rejection } = confirm;
  const acting = stage === CONFIRM_STAGE.ACTING;
  const [wasStage, setWasStage] = useState(stage);
  const [landed, setLanded] = useState(false);
  // Whether the landed check has been seen, which puts the question away
  // still wearing it, so it goes as it stood rather than as a question again.
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

/**
 * The question over the window while it is asked, running, or refused, and
 * for the beat its check shows once the act lands, and nothing otherwise,
 * in the shared `Dialog`, fading out as it goes.
 */
export function ConfirmDialog({
  open,
  confirm,
  question,
  field,
  gate,
  restoreTo,
  children,
}: {
  /** Whether its owner shows it at all; falling, the card fades out. */
  open: boolean;
  confirm: DialogConfirm;
  question: DialogQuestion;
  /** A field the question asks to be filled, which takes focus in Cancel's place; Enter in it answers. */
  field?: React.RefObject<HTMLInputElement | null> | undefined;
  /**
   * The subject's name, for an act past undoing at its gravest (deleting an
   * account): the act stands unavailable until it is typed exactly, in a
   * field that takes focus in Cancel's place. An ordinary delete asks no gate.
   */
  gate?: string | undefined;
  /** Where focus goes once the card is gone if the act took away what asked (`nextRowOrHead`), as `Dialog` takes it. */
  restoreTo?: RestoreTo | undefined;
  /** What the card holds under its body: the field, where the question asks one. */
  children?: React.ReactNode;
}): React.JSX.Element {
  const answer = useAnswerState(confirm);
  // Note that an answer under way is hidden with its surface rather than
  // drawn over whatever stands in its place, because the window then
  // presents something else; the act itself finishes all the same.
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

/** The question's words at the foot's start, given the room the answers leave, and its answers at the end. */
const FOOT_QUESTION = "flex min-w-0 flex-1 items-center gap-dialog-action-gap";
const FOOT_WORDS = "flex min-w-0 flex-1 flex-col";

/**
 * A question asked inside a dialog about something the dialog holds (a key
 * it shows, a sign-in it keeps), drawn at that dialog's foot in place of its
 * answers rather than as a second card over it: the question's title and
 * what goes at the foot's start, Cancel and the act at its end, coloured by
 * what it costs as `ConfirmDialog`'s are. It stands in the dialog's body
 * where the control that asks it is, and draws nothing there; it must stand
 * inside a `Dialog`.
 *
 * While it is asked what the dialog holds stands still and takes no press,
 * focus is on Cancel, and Escape, a press on the dimmed window, and Cancel
 * withdraw it, the dialog staying open; focus then goes back to whatever
 * asked if that still stands. An answer under way stills both buttons and
 * the dialog, one that lands wears its check until it has been seen and
 * then hands the foot back, and one that was refused keeps the question up
 * saying why, shaking the card, so the act can be tried again or let go.
 */
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
  // Note that the dialog reads the newest withdrawal as Escape lands, so
  // the foot is claimed again only as what the dialog holds it by changes.
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
          {question.title}
        </Text>
        {question.body ? (
          <p id={bodyId} className={BODY}>
            {question.body}
          </p>
        ) : null}
        <ErrorLine>{refused ? confirm.rejection : null}</ErrorLine>
      </div>
      <div className={DIALOG_ANSWERS}>
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
      </div>
    </div>,
    foot.slot,
  );
}
