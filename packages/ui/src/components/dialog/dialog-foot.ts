import { createContext, type RefObject, useContext } from "react";

/**
 * dialog-foot.ts -- a dialog's foot as what it holds may claim it: the slot a
 * question asked inside the card is drawn in, in place of the card's answers.
 *
 * A card that asks a question of its own about something it holds (removing
 * a key it shows) asks it at its foot rather than over itself: the foot's
 * answers give way to the question, its words at the start and Cancel and
 * the act at the end, while what the card holds stands still behind it. The
 * card hands its foot to whatever claims it through this context, so the
 * question is drawn by the part that asks it, however deep in the card, and
 * the card learns only that it is asked, how to take it back, where focus
 * goes, and whether it is at work or was refused.
 */

/** The foot's layout, whatever it holds: a tool at its start, the answers at its end. */
export const DIALOG_FOOT = "flex min-w-0 shrink-0 items-center gap-dialog-action-gap mt-3";

/** The answers at the foot's end, at a common width. */
export const DIALOG_ANSWERS =
  "ml-auto flex shrink-0 gap-dialog-action-gap [&>.luke-button]:min-w-dialog-action";

/** A question standing in the foot, as the card hears it. */
export interface FootClaim {
  /** Takes the question back, as Escape or a press on the dimmed window asks; false where an answer under way keeps it. */
  withdraw: () => boolean;
  /** What takes focus while it is asked: its Cancel. */
  focus: RefObject<HTMLElement | null>;
  /** Whether its answer is under way, which stills the card as a busy dialog is. */
  busy: boolean;
  /** Whether its answer was refused and the refusal stands, which shakes the card as it lands. */
  refused: boolean;
}

/** What the card hands what it holds: where a question is drawn, and how one claims it. */
export interface DialogFoot {
  /** The element a question is drawn into; null until the card stands. */
  slot: HTMLElement | null;
  /** Claims the foot for a question; what it answers lets the foot go. */
  claim: (claim: FootClaim) => () => void;
}

export const DialogFootContext = createContext<DialogFoot | undefined>(undefined);

/** The foot of the card this stands in, or none outside a dialog. */
export function useDialogFoot(): DialogFoot | undefined {
  return useContext(DialogFootContext);
}
