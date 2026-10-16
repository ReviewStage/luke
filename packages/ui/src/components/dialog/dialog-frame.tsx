import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useStagedFocus } from "./staged-focus.js";

/**
 * dialog-frame.tsx -- the dialog's markup and keyboard, which the barrel's
 * `Dialog` and the compatibility door's twin both draw, so they are one
 * dialog.
 */

/** What the card is to assistive technology: a dialog, or a question that must be answered before going on. */
export const DIALOG_ROLE = {
  DIALOG: "dialog",
  ALERT_DIALOG: "alertdialog",
} as const;

export type DialogRole = (typeof DIALOG_ROLE)[keyof typeof DIALOG_ROLE];

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

/** The `data-` attributes a caller still draws its card with, for its own styles. */
type CardData = { [attribute: `data-${string}`]: string | undefined };

/** What a dialog is told: who names it, whether it is at work, where focus lands, and how it is put away. */
export interface DialogProps {
  role?: DialogRole | undefined;
  /** The id of the card's title. */
  labelledBy: string;
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
  children: React.ReactNode;
}

/** A dialog that still wears its caller's classes and `data-` attributes beside its own. */
export type DialogFrameProps = DialogProps &
  CardData & {
    /** Classes the card wears beside its own. */
    className?: string | undefined;
    /** Classes the dimmed window wears beside its own. */
    backdropClassName?: string | undefined;
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

/** `own` with `extra` beside it, where a caller still passes some. */
function classes(own: string, extra: string | undefined): string {
  return extra === undefined ? own : `${own} ${extra}`;
}

/**
 * The dimmed window and the card over it, drawn over `document.body` so no
 * stacking context of the surface that opened it can clip or cover it.
 * Focus lands on `initialFocus`, or on the card itself where there is none,
 * and goes to the card while `busy` stills the controls, so it never falls
 * to the window behind.
 */
export function DialogFrame({
  role = DIALOG_ROLE.DIALOG,
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
}: DialogFrameProps): React.JSX.Element {
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
      className={classes("luke-dialog-backdrop", backdropClassName)}
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
        {...data}
        ref={card}
        className={classes("luke-dialog", className)}
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
