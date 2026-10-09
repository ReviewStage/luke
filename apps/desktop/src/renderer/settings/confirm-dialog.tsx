import type { ActionResult } from "@sidecar/wire";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useStagedFocus } from "../staged-focus";
import {
  CONFIRM_STAGE,
  type ConfirmSurroundings,
  confirmAsked,
  confirmWithdrawable,
  type HeldConfirm,
  useConfirm,
} from "./confirm-state";

/**
 * confirm-dialog.tsx -- an irreversible act's question as a modal over the window: what goes, then Cancel and the act.
 *
 * The desktop window asks the way every desktop app does: the window dims, a
 * card names what the act takes with it, and the two answers sit at its foot,
 * the safe one first and the act in red last. Focus lands on Cancel, so a key
 * already pressed changes nothing; Tab stays inside the card; Escape, a press
 * on the dimmed window, and Cancel all withdraw it and hand focus back to
 * whatever asked. Enter is the focused button's own, so it acts only from the
 * act's button.
 *
 * The question is `confirm-state.ts`'s, so it withdraws the render its subject
 * or its surface goes. An answer already given finishes where it stands with
 * both buttons stilled; one that was refused keeps the card up saying why, so
 * the act can be tried again or let go.
 */

/** What the dialog says: its title, what the act takes with it, and the act's word, and its word while it runs. */
export interface DialogQuestion {
  title: string;
  body: string;
  verb: string;
  running: string;
}

const FOCUSABLE = "button:not([disabled])";

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

/** The move Tab makes from the focused element, kept to the card's own buttons. */
function trappedTab(event: React.KeyboardEvent<HTMLElement>): void {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const at = buttons.findIndex((button) => button === document.activeElement);
  // Note that the ends wrap and a focus off the buttons (the card itself,
  // while the act runs) comes back onto them, because past either end the
  // browser's own move would leave the card for the window behind it.
  const wraps = event.shiftKey ? at <= 0 : at === -1 || at === buttons.length - 1;
  if (!wraps) return;
  event.preventDefault();
  (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
}

/**
 * The question over the window while it is asked, running, or refused, and
 * nothing otherwise. Drawn over `document.body` so no stacking context of the
 * surface that asked can clip or cover it.
 */
export function ConfirmDialog({
  confirm,
  question,
}: {
  confirm: DialogConfirm;
  question: DialogQuestion;
}): React.JSX.Element | null {
  const { stage, rejection } = confirm;
  // Note that an answer under way is hidden with its surface rather than
  // drawn over whatever stands in its place, because the window then
  // presents something else; the act itself finishes all the same.
  const open = confirm.standing && (confirmAsked(stage) || rejection !== undefined);
  const acting = stage === CONFIRM_STAGE.ACTING;
  const card = useRef<HTMLDivElement | null>(null);
  const cancel = useRef<HTMLButtonElement | null>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const answered = useRef(false);
  const titleId = useId();
  const bodyId = useId();

  // Note that the invoker is read before Cancel takes focus, because once it
  // has, the element that asked is no longer the one holding it.
  useLayoutEffect(() => {
    if (!open) return;
    invoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    answered.current = false;
  }, [open]);

  useStagedFocus(cancel, open && !acting);
  // Both answers are stilled while the act runs, so the card holds focus
  // itself rather than letting it fall to the window behind.
  useStagedFocus(card, open && acting);

  // Only an answer hands focus back: a question withdrawn because its surface
  // went was never answered, and reaching into a shape that is leaving would
  // pull it back.
  useEffect(() => {
    if (open || !answered.current) return;
    answered.current = false;
    if (invoker.current?.isConnected) invoker.current.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  const dismiss = () => {
    if (acting) return;
    answered.current = true;
    if (confirmWithdrawable(stage)) confirm.keep();
    confirm.clear();
  };
  const act = () => {
    answered.current = true;
    confirm.run();
  };
  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Note that no key pressed in the dialog goes on to the window, because
    // a window chord (Command-comma, Command-B) would change what stands
    // behind a question nobody has answered. A button's own Enter and Space
    // are its default action, which this leaves alone.
    event.stopPropagation();
    if (event.key === "Tab") {
      trappedTab(event);
      return;
    }
    // The dialog is the nearest layer, so Escape withdraws it alone and
    // leaves the window behind it as it was.
    if (event.key !== "Escape") return;
    event.preventDefault();
    dismiss();
  };

  return createPortal(
    // The dimmed window takes a press as Cancel, and the keys pressed
    // anywhere in the card reach it on their way out.
    // biome-ignore lint/a11y/noStaticElementInteractions: the dimmed window is a pointer target alone; the keys it hears come from the card's own focus.
    <div
      className="confirm-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
      onKeyDown={keyDown}
    >
      <div
        ref={card}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        aria-busy={acting}
        tabIndex={-1}
      >
        <h2 id={titleId} className="confirm-dialog-title">
          {question.title}
        </h2>
        <p id={bodyId} className="confirm-dialog-body">
          {question.body}
        </p>
        {rejection !== undefined && !acting ? (
          <p className="confirm-dialog-error" role="alert">
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
          <button type="button" className="danger-button" disabled={acting} onClick={act}>
            {acting ? question.running : question.verb}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
