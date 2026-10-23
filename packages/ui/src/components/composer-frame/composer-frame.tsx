import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";

/**
 * composer-frame.tsx -- the frame a message is written in: its edge, its corner, and its ground, and the edge brightened while files are dragged over it.
 *
 * The frame owns how a composer stands and nothing it holds: the field, the
 * files over it, and the foot of presses under it are the owner's, laid out
 * by the owner's own class. It clips nothing, because the field's `@` and `/`
 * menus open past its edge. Its look is a finite choice (`COMPOSER_LOOK`): the
 * window's message box, a card on the sidebar's ground at a card's corner,
 * as an agent's box, the Inbox's, and a thread's reply stand; a field on the
 * page's ground at a control's corner, as a comment is answered in a card's
 * well; or bare, no frame at all, where the card around it is the frame, as a
 * thread's first comment is. The note a box gives way to stands on the same
 * frame, so it stands where the box stood. It is a form where it sends and a
 * div where it does not (`COMPOSER_ELEMENT`).
 */

/** How a composer stands: the window's message box, a field in a card's well, or no frame of its own. */
export const COMPOSER_LOOK = {
  CARD: "card",
  FIELD: "field",
  BARE: "bare",
} as const;

export type ComposerLook = (typeof COMPOSER_LOOK)[keyof typeof COMPOSER_LOOK];

/** The elements a composer's frame may be: a form where its foot's submit sends it, a div where it does not. */
export const COMPOSER_ELEMENT = {
  FORM: "form",
  DIV: "div",
} as const;

export type ComposerElement = (typeof COMPOSER_ELEMENT)[keyof typeof COMPOSER_ELEMENT];

/** `children` framed as a composer. */
export function ComposerFrame({
  as: Element = COMPOSER_ELEMENT.DIV,
  look = COMPOSER_LOOK.CARD,
  dropping = false,
  className,
  ref,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "className" | "children"> & {
  as?: ComposerElement;
  look?: ComposerLook;
  /** Whether files are dragged over it, which brightens its edge, so the drop target is the frame itself. */
  dropping?: boolean | undefined;
  /** The owner's own class, which names, places, and lays out what it holds, and sets nothing of its frame. */
  className?: string | undefined;
  /** The frame's element, for what asks whether the focus is inside it. */
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  // Note that the element is made rather than written, as a card's is.
  return createElement(
    Element,
    {
      ...rest,
      ref,
      className:
        className === undefined ? "luke-composer-frame" : `luke-composer-frame ${className}`,
      "data-look": look,
      "data-dropping": dropping ? "true" : undefined,
    },
    children,
  );
}
