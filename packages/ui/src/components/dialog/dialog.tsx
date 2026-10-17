import { DialogFrame, type DialogProps } from "./dialog-frame.js";

/**
 * dialog.tsx -- the window dimmed under one card that holds the keyboard
 * until it is put away: every modal's frame, whatever it asks.
 *
 * Every modal stands the same way, the way every desktop app's does: the
 * window dims, the card holds focus and keeps Tab among its own controls,
 * and Escape or a press that begins and ends on the dimmed window puts it
 * away, which hands focus back to whatever opened it if that still stands.
 * A press that begins in the card and ends on the dimmed window, as a text
 * selection dragged out of the card does, puts nothing away. No key and no
 * press inside goes on to the window, because a window chord or a press on a
 * row would change what stands behind a card nobody has finished with. What
 * the card says, its own keys (Return in a field, Command-Return, the
 * arrows), and what a dismissal costs are the dialog's own.
 *
 * The dialog stands only while it is open, so mounting it is opening and
 * unmounting it is closing, however it came to close. The card is the
 * profile's dialog card, its inset and its corners, at a question's
 * measure or wider for a note being written; what it holds lays itself out
 * inside. A dialog that takes files dropped on the dimmed window rings its
 * card while a drag it would take is over it.
 */

export {
  DIALOG_ROLE,
  DIALOG_SIZE,
  type DialogProps,
  type DialogRole,
  type DialogSize,
} from "./dialog-frame.js";

/** A modal card over the dimmed window, named by `labelledBy` and put away by `onDismiss`. */
export function Dialog(props: DialogProps): React.JSX.Element {
  return <DialogFrame {...props} />;
}
