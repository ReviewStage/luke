import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useStagedFocus } from "./staged-focus";

/**
 * modal-shell.tsx -- the window dimmed under one card that holds the keyboard until it is put away: every modal's frame, whatever it asks.
 *
 * Every modal over the desktop window stands the same way, the way every
 * desktop app's does: the window dims, the card holds focus and keeps Tab
 * among its own controls, and Escape or a press that begins and ends on the
 * dimmed window puts it away, which hands focus back to whatever opened it
 * if that still stands. A press that begins in the card and ends on the
 * dimmed window, as a text selection dragged out of the card does, puts
 * nothing away. No key and no press inside goes on to the window, because a
 * window chord or a press on a row would change what stands behind a card
 * nobody has finished with. What the card says, its own keys (Return in a
 * field, Command-Return, the arrows), and what a dismissal costs are the
 * dialog's own.
 *
 * The shell stands only while its dialog is open, so mounting it is opening
 * and unmounting it is closing, however the dialog came to close.
 */

/** What the card is to assistive technology: a dialog, or a question that must be answered before going on. */
export const MODAL_ROLE = {
  DIALOG: "dialog",
  ALERT_DIALOG: "alertdialog",
} as const;

type ModalRole = (typeof MODAL_ROLE)[keyof typeof MODAL_ROLE];

/** What Tab may land on inside the card: its enabled controls, and never a hidden one. */
const FOCUSABLE =
  "button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([hidden])";

/** The `data-` attributes a dialog draws its card with, for its own styles. */
type CardData = { [attribute: `data-${string}`]: string | undefined };

/** The move Tab makes from the focused element, kept to the card's own controls. */
function trappedTab(event: React.KeyboardEvent<HTMLElement>): void {
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const at = controls.findIndex((control) => control === document.activeElement);
  // Note that the ends wrap and a focus off the controls (the card itself,
  // while the dialog is at work) comes back onto them, because past either
  // end the browser's own move would leave the card for the window behind it.
  const wraps = event.shiftKey ? at <= 0 : at === -1 || at === controls.length - 1;
  if (!wraps) return;
  event.preventDefault();
  (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
}

/**
 * Remembers what held focus as the shell opened and hands focus back to it
 * as the shell closes, unless it has left the window meanwhile.
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
export function ModalShell({
  role = MODAL_ROLE.DIALOG,
  className,
  backdropClassName,
  labelledBy,
  describedBy,
  busy = false,
  initialFocus,
  onDismiss,
  onKeyDown,
  dropTarget,
  children,
  ...data
}: {
  role?: ModalRole;
  /** The card's classes. */
  className: string;
  /** Classes the dimmed window wears beside its own. */
  backdropClassName?: string;
  /** The id of the card's title. */
  labelledBy: string;
  /** The id of what the card says, where it is a question. */
  describedBy?: string;
  /** Whether the dialog is at work, its controls stilled. */
  busy?: boolean;
  /** The control that takes focus as the card opens and again whenever the dialog is no longer busy. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** Escape or a press on the dimmed window: the dialog decides what putting it away costs. */
  onDismiss: () => void;
  /** The dialog's own keys, heard after Tab and Escape and never while an input method composes. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** What the dimmed window does with a drag, for a dialog that takes files dropped anywhere on it. */
  dropTarget?: Pick<React.HTMLAttributes<HTMLDivElement>, "onDragOver" | "onDragLeave" | "onDrop">;
  children: React.ReactNode;
} & CardData): React.JSX.Element {
  const card = useRef<HTMLDivElement | null>(null);
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
      className={
        backdropClassName === undefined
          ? "confirm-dialog-backdrop"
          : `confirm-dialog-backdrop ${backdropClassName}`
      }
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Note that a press goes no further than the shell, because the
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
        {...data}
        ref={card}
        className={className}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-busy={busy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
