import { useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { useStagedFocus } from "./staged-focus.js";

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
 * measure, wider for a note being written, or fitted edge to edge to a file
 * shown; what it holds lays itself out inside. A dialog that takes files dropped on the dimmed window rings its
 * card while a drag it would take is over it.
 *
 * A dialog that asks something draws its parts in the card's own slots: its
 * `title` at its head, which names the card, and its `actions` at its foot,
 * Cancel first and the act last at the foot's end, each answer at a common
 * width so a short verb is not a smaller target than Cancel beside it, with a
 * tool of the dialog's own (attaching a screenshot) at the foot's start where
 * it has one. What it holds between them is the part that gives way and
 * scrolls, so its title and its answers stay on screen however short the
 * window is. A dialog whose head is more than words (a picture's bar, a title
 * holding a chip) draws its own and names the card by it (`labelledBy`).
 */

/** What the card is to assistive technology: a dialog, or a question that must be answered before going on. */
export const DIALOG_ROLE = {
  DIALOG: "dialog",
  ALERT_DIALOG: "alertdialog",
} as const;

export type DialogRole = (typeof DIALOG_ROLE)[keyof typeof DIALOG_ROLE];

/**
 * How wide the card stands: a question's measure, wider for a note being
 * written, wider still for a composer card with chips at its foot, or fitted
 * to a file shown edge to edge, as a picture opened over the window is.
 */
export const DIALOG_SIZE = {
  CONFIRM: "confirm",
  WIDE: "wide",
  COMPOSER: "composer",
  MEDIA: "media",
} as const;

export type DialogSize = (typeof DIALOG_SIZE)[keyof typeof DIALOG_SIZE];

/**
 * What Tab may land on inside the card: its enabled controls and links, and
 * anything else given a place in the Tab order. Note that one taken out of
 * that order, as a menu's rows are, is dropped by its `tabIndex` rather than
 * here, because any negative value takes it out.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "input:not([disabled]):not([hidden])",
  "[tabindex]:not(:disabled)",
].join(", ");

/** What names the card: the title drawn at its head, or the id of a head the dialog draws itself. */
type DialogName =
  | {
      /** The card's title, drawn at its head in the dialog's type. */
      title: string;
      labelledBy?: undefined;
    }
  | {
      title?: undefined;
      /** The id of the card's title, where the dialog draws its own head. */
      labelledBy: string;
    };

/** What a dialog is told: who names it, whether it is at work, where focus lands, and how it is put away. */
export type DialogProps = DialogName & {
  role?: DialogRole | undefined;
  /** How wide the card stands, a question's measure unless asked. */
  size?: DialogSize | undefined;
  /** The id of what the card says, where it is a question. */
  describedBy?: string | undefined;
  /** Whether the dialog is at work, its controls stilled. */
  busy?: boolean | undefined;
  /** The control that takes focus as the card opens and again whenever the dialog is no longer busy. */
  initialFocus?: React.RefObject<HTMLElement | null> | undefined;
  /** Escape or a press on the dimmed window: the dialog decides what putting it away costs. */
  onDismiss: () => void;
  /** The dialog's own keys, heard after Tab and Escape and never while an input method composes. */
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** What the dimmed window does with a drag, for a dialog that takes files dropped anywhere on it. */
  dropTarget?:
    | Pick<React.HTMLAttributes<HTMLDivElement>, "onDragOver" | "onDragLeave" | "onDrop">
    | undefined;
  /** Whether a drag the dimmed window would take is over it, which rings the card that will take it. */
  dropping?: boolean | undefined;
  /** The answers at the card's foot, at its end: Cancel first, the act last. */
  actions?: React.ReactNode;
  /** A tool of the dialog's own at the foot's start, before its answers. */
  actionsStart?: React.ReactNode;
  children: React.ReactNode;
};

/** Whether `first` comes before `second` in the document's order. */
function precedes(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** The move Tab makes from the focused element, kept to the card's own controls. */
function trappedTab(event: React.KeyboardEvent<HTMLElement>): void {
  const card = event.currentTarget;
  const controls = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (control) => control.tabIndex >= 0,
  );
  const focused = document.activeElement;
  const at = focused instanceof HTMLElement ? controls.indexOf(focused) : -1;
  // Note that a focus inside the card off its controls, a picker's list that
  // holds the keyboard, moves to the control beside it in the card's order,
  // because counting it as off the controls would send it to an end instead.
  if (at === -1 && focused !== null && focused !== card && card.contains(focused)) {
    const beside = event.shiftKey
      ? controls.findLast((control) => precedes(control, focused))
      : controls.find((control) => precedes(focused, control));
    event.preventDefault();
    (beside ?? (event.shiftKey ? controls.at(-1) : controls[0]))?.focus();
    return;
  }
  // Note that the ends wrap and a focus off the controls (the card itself,
  // while the dialog is at work) comes back onto them, because past either
  // end the browser's own move would leave the card for the window behind it.
  const wraps = event.shiftKey ? at <= 0 : at === -1 || at === controls.length - 1;
  if (!wraps) return;
  event.preventDefault();
  (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
}

/**
 * Remembers what held focus as the dialog opened and hands focus back to it
 * as the dialog closes, unless it has left the window meanwhile.
 *
 * Note that the invoker is read in a layout effect, because the card's own
 * focus lands in a later effect, and once it has, the control that opened
 * the card no longer holds it.
 */
function useInvokerFocus(): void {
  useLayoutEffect(() => {
    const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (invoker?.isConnected) invoker.focus({ preventScroll: true });
    };
  }, []);
}

/**
 * The dimmed window and the card over it, drawn over `document.body` so no
 * stacking context of the surface that opened it can clip or cover it.
 * Focus lands on `initialFocus`, or on the card itself where there is none,
 * and goes to the card while `busy` stills the controls, so it never falls
 * to the window behind.
 */
export function Dialog({
  role = DIALOG_ROLE.DIALOG,
  size = DIALOG_SIZE.CONFIRM,
  title,
  labelledBy,
  describedBy,
  busy = false,
  initialFocus,
  onDismiss,
  onKeyDown,
  dropTarget,
  dropping = false,
  actions,
  actionsStart,
  children,
}: DialogProps): React.JSX.Element {
  const card = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const pressedBackdrop = useRef(false);

  useInvokerFocus();
  useStagedFocus<HTMLElement>(initialFocus ?? card, !busy);
  useStagedFocus(card, busy);

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Note that no key pressed in the card goes on to the window. A button's
    // own Enter and Space are its default action, which this leaves alone.
    event.stopPropagation();
    // A key an input method is composing with is the method's, not the dialog's.
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Tab") {
      trappedTab(event);
      return;
    }
    // The card is the nearest layer, so Escape puts it away alone and leaves
    // the window behind it as it was.
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss();
      return;
    }
    onKeyDown?.(event);
  };

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the dimmed window is a pointer and drop target alone; the keys it hears come from the card's own focus.
    <div
      className="luke-dialog-backdrop"
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Note that a press goes no further than the dialog, because the
        // surface that opened it is its parent in React's tree and may take
        // presses of its own.
        event.stopPropagation();
        if (pressedBackdrop.current && event.target === event.currentTarget) onDismiss();
        pressedBackdrop.current = false;
      }}
      onKeyDown={keyDown}
      {...dropTarget}
    >
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is a dialog or an alert dialog, and both are modal. */}
      <div
        data-size={size}
        data-dropping={dropping}
        ref={card}
        className="luke-dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        aria-describedby={describedBy}
        aria-busy={busy}
        tabIndex={-1}
      >
        {title === undefined ? null : (
          <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
            {title}
          </Text>
        )}
        {children}
        {actions === undefined && actionsStart === undefined ? null : (
          <div className="luke-dialog-foot">
            {actionsStart}
            <div className="luke-dialog-actions">{actions}</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
