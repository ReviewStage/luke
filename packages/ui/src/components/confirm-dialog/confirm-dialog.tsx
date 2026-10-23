import type { ActionResult } from "@luke/wire";
import { useId, useMemo, useRef, useState } from "react";
import {
  CONFIRM_STAGE,
  type ConfirmSurroundings,
  confirmAsked,
  confirmWithdrawable,
  type HeldConfirm,
  useConfirm,
} from "../../confirm-state.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { DIALOG_ROLE, Dialog } from "../dialog/dialog.js";
import { FormField } from "../form-field/form-field.js";
import { TEXT_FIELD_AUTO_COMPLETE, TextField } from "../text-field/text-field.js";

/**
 * confirm-dialog.tsx -- an irreversible act's question as a modal over the window: what goes, then Cancel and the act.
 *
 * The window asks the way every desktop app does: it dims, a card names what
 * the act takes with it, and the two answers sit at its foot, the safe one
 * first and the act in red last, or in the accent for an act that can be
 * undone, such as restoring a version of a plan. Focus lands on Cancel, so a
 * key already pressed changes nothing; Tab stays inside the card; Escape, a
 * press on the dimmed window, and Cancel all withdraw it, and however it
 * goes, focus goes back to whatever asked if that still stands. Enter is the
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

export type DialogTone = (typeof DIALOG_TONE)[keyof typeof DIALOG_TONE];

/** The act's button's look, by its tone. */
const ACT_VARIANT = {
  [DIALOG_TONE.DANGER]: BUTTON_VARIANT.DANGER,
  [DIALOG_TONE.PRIMARY]: BUTTON_VARIANT.PRIMARY,
} as const satisfies Record<DialogTone, string>;

/** What the dialog says: its title, what the act takes with it if anything needs saying, and the act's word, and what a reader is told while it runs; the act is red unless its tone says otherwise. */
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
  return useMemo(() => ({ ...held, standing }), [held, standing]);
}

/**
 * What the act takes with it, the name a gate asks for, and a refusal,
 * between the shared dialog's title and its answers. The body is the part
 * that gives way and scrolls, so the title and the answers stay on screen
 * however short the window is; the gate's name is set apart from the words
 * around it so it reads as exactly what to type.
 */
const BODY =
  "m-0 min-h-0 overflow-x-hidden overflow-y-auto text-body text-muted-foreground wrap-anywhere";
const GATE = "font-mono text-foreground wrap-anywhere";
const REFUSAL = "m-0 text-caption text-danger wrap-anywhere";

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
 * empty every time it is asked.
 */
function ConfirmCard({
  confirm,
  question,
  field,
  gate,
  act,
  children,
}: {
  confirm: DialogConfirm;
  question: DialogQuestion;
  field: React.RefObject<HTMLInputElement | null> | undefined;
  gate: string | undefined;
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
  // shake; anywhere else Enter is the focused button's own.
  const fieldKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || settling) return;
    if (event.target !== field?.current && event.target !== gateField.current) return;
    event.preventDefault();
    actButton.current?.click();
  };

  return (
    <Dialog
      role={DIALOG_ROLE.ALERT_DIALOG}
      title={question.title}
      describedBy={question.body ? bodyId : undefined}
      busy={settling}
      refused={rejection !== undefined && !acting}
      initialFocus={field ?? (gate === undefined ? cancel : gateField)}
      onDismiss={dismiss}
      onKeyDown={fieldKey}
      actions={
        <>
          <Button ref={cancel} variant={BUTTON_VARIANT.QUIET} disabled={settling} onClick={dismiss}>
            Cancel
          </Button>
          <Button
            ref={actButton}
            variant={ACT_VARIANT[question.tone ?? DIALOG_TONE.DANGER]}
            disabled={acting || locked}
            focusableWhenDisabled={locked}
            busy={acting}
            busyLabel={question.running}
            done={landed}
            onDone={act.onShown}
            onClick={() => confirm.run()}
          >
            {question.verb}
          </Button>
        </>
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
      {rejection !== undefined && !acting ? (
        <p className={REFUSAL} role="alert">
          {rejection}
        </p>
      ) : null}
    </Dialog>
  );
}

/**
 * The question over the window while it is asked, running, or refused, and
 * for the beat its check shows once the act lands, and nothing otherwise,
 * in the shared `Dialog`.
 */
export function ConfirmDialog({
  confirm,
  question,
  field,
  gate,
  children,
}: {
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
  /** What the card holds under its body: the field, where the question asks one. */
  children?: React.ReactNode;
}): React.JSX.Element | null {
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
  // Note that an answer under way is hidden with its surface rather than
  // drawn over whatever stands in its place, because the window then
  // presents something else; the act itself finishes all the same.
  const open = confirm.standing && (confirmAsked(stage) || rejection !== undefined || landed);

  if (!open) return null;
  return (
    <ConfirmCard
      confirm={confirm}
      question={question}
      field={field}
      gate={gate}
      act={{ acting, landed, onShown: () => setLanded(false) }}
    >
      {children}
    </ConfirmCard>
  );
}
