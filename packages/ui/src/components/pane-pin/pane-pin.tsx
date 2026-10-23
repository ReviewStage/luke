import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";

/**
 * pane-pin.tsx -- the box of a pane that floats over the work, or of the controls that float it, which pins the float against the press outside that puts it away.
 *
 * A floating pane is put away by a press anywhere outside it, heard at the
 * document as it bubbles; a press inside it, or on the toggle that floated
 * it, is marked as its own first (`onPin`), so the document's press leaves
 * it standing. It is no control: the controls inside it keep their own
 * presses, it plays no pulse, and it speaks as the region it is. Its owner
 * names, places, and draws it by its own class, and hands it the pane's own
 * events, the pointer leaving a peek and the keys a pane hears as a
 * container (Escape), as any element takes them.
 */

/** The elements a pinned box may be: a pane, or the strip of controls that floats one. */
export const PANE_PIN_ELEMENT = {
  ASIDE: "aside",
  DIV: "div",
} as const;

export type PanePinElement = (typeof PANE_PIN_ELEMENT)[keyof typeof PANE_PIN_ELEMENT];

/** A floating pane's box, or its toggle's, whose presses pin the float. */
export function PanePin({
  as: Element = PANE_PIN_ELEMENT.ASIDE,
  onPin,
  className,
  ref,
  children,
  ...rest
}: Omit<
  HTMLAttributes<HTMLElement>,
  "className" | "onClick" | "onPointerDown" | "onMouseDown" | "role"
> & {
  as?: PanePinElement;
  /** Marks a press within as the pane's own, as the pointer goes down and before the document hears it; none while nothing floats. */
  onPin: (() => void) | undefined;
  /** The owner's own class, which names, places, and draws it. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  // Note that the element is made rather than written, because a ref typed
  // for either is no ref for their union.
  return createElement(
    Element,
    {
      ...rest,
      ref,
      className: className === undefined ? "luke-pane-pin" : `luke-pane-pin ${className}`,
      onPointerDown: onPin === undefined ? undefined : () => onPin(),
    },
    children,
  );
}
