import type { MouseEvent, ReactNode, Ref } from "react";
import { PRESS_PULSE, pulsePress } from "../../press-pulse.js";

/**
 * command-link.tsx -- words that a ⌘-click (Ctrl-click off a Mac) opens what they name from, as an editor's ⌘-click follows a reference: a pull request's title opening it on GitHub.
 *
 * Only the chord opens: a plain press still selects the words, and a press
 * on a button among them is the button's own. It is the pointer's shortcut
 * to an act the place offers the keyboard elsewhere (a header's ⋯ menu), so
 * it is no control of its own and no Tab stop. It draws nothing beyond the
 * element it is drawn as, in `className` beside the shared one.
 */

/** The elements the words may be drawn as: words in a row, or a heading. */
export const COMMAND_LINK_ELEMENT = {
  SPAN: "span",
  H2: "h2",
} as const;

export type CommandLinkElement = (typeof COMMAND_LINK_ELEMENT)[keyof typeof COMMAND_LINK_ELEMENT];

/** A `data-` attribute a place names the words by. */
type DataAttributes = { readonly [name: `data-${string}`]: string | undefined };

/** Words a ⌘-click opens what they name from; nothing opens where `onOpen` is none. */
export function CommandLink({
  as: Tag = COMMAND_LINK_ELEMENT.SPAN,
  className,
  ref,
  onOpen,
  children,
  ...data
}: DataAttributes & {
  as?: CommandLinkElement | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  /** Opens what the words name, which a ⌘-click on them asks. */
  onOpen?: (() => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const open = (event: MouseEvent<HTMLElement>) => {
    if (onOpen === undefined || !(event.metaKey || event.ctrlKey)) return;
    if (event.target instanceof Element && event.target.closest("button") !== null) return;
    event.preventDefault();
    pulsePress(event.currentTarget, PRESS_PULSE.WORDS);
    onOpen();
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the ⌘-click is a pointer's shortcut alone; the place offers the keyboard the same act elsewhere.
    // biome-ignore lint/a11y/noStaticElementInteractions: as above.
    <Tag
      {...data}
      ref={ref as Ref<HTMLHeadingElement & HTMLSpanElement>}
      className={className === undefined ? "luke-command-link" : `luke-command-link ${className}`}
      onClick={open}
    >
      {children}
    </Tag>
  );
}
