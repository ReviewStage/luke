/**
 * message.tsx -- one turn of a conversation, and the bar of actions in the line under it, shown while the pointer or the keyboard is on the turn and, on a screen with no hover, once the turn is tapped.
 *
 * A transcript of hundreds of turns would be a column of buttons if every
 * turn's actions stood at rest, so a `MessageActions` bar inside a
 * `MessageFrame` stays hidden, and takes no pointer, until the pointer rests
 * on the turn or the keyboard is on one of its actions. A
 * screen with no hover has none to show them by, so a frame that
 * `revealActionsOnTap` shows them at a tap on the turn, anywhere but a
 * control of its own, and hides them at another. The screen is asked at the
 * tap, never kept, so a mouse changes nothing, and a press that ends a
 * selection of the turn's words leaves them be. The turn's own look, who
 * said it and where it stands in the column, is its caller's.
 *
 * The reveal is drawn in the Tailwind theme's utilities: the frame is the
 * group its bar answers (`group/message`), the pointer's rest counting only
 * where there is a hover, a tap's only where there is none, and a bar whose
 * action holds a hover card standing (`Tooltip` marks it described) while
 * the pointer crosses onto the card, off the turn.
 */

import { type HTMLAttributes, type ReactNode, useState } from "react";

/** What a tap may land on in a turn that is a control of its own, which a tap works rather than showing the turn's actions. */
const OWN_CONTROL =
  "a, button, summary, input, textarea, select, label, [role='button'], [role='tab']";

/** The media query a screen with no hover answers, the one message.css shows a tapped turn's actions under. */
const NO_HOVER = "(hover: none)";

/**
 * One turn, holding its words and its actions. `className` is the caller's
 * skin for the turn; the frame draws nothing of its own but the reveal.
 */
/** The turn, the group its actions answer. */
const FRAME = "luke-message group/message";

/** The bar, hidden and taking no pointer until the turn, its keyboard, or its hover card asks it up. */
const ACTIONS =
  "luke-message-actions pointer-events-none flex flex-none items-center gap-luke-2 opacity-0 transition-opacity duration-(--luke-duration-hover) ease-motion-exit focus-within:pointer-events-auto focus-within:opacity-100 has-[[aria-describedby]]:pointer-events-auto has-[[aria-describedby]]:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100 no-hover:group-data-[actions-shown=true]/message:pointer-events-auto no-hover:group-data-[actions-shown=true]/message:opacity-100";

export function MessageFrame({
  revealActionsOnTap = false,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "className" | "onClick"> & {
  /** Whether a tap on a screen with no hover shows the turn's actions, and another hides them. */
  revealActionsOnTap?: boolean;
  className?: string | undefined;
}): React.JSX.Element {
  const [actionsShown, setActionsShown] = useState(false);
  const tap = (event: React.MouseEvent<HTMLDivElement>) => {
    // A tap spent on something of the turn's own, a control or a hint it opened, shows nothing more.
    if (event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest(OWN_CONTROL) !== null) return;
    if (window.getSelection()?.isCollapsed === false) return;
    if (!window.matchMedia(NO_HOVER).matches) return;
    setActionsShown((shown) => !shown);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a tap stands in for the hover a finger lacks; the keyboard reaches the actions themselves, which show while they hold it.
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above, the keyboard needs no key here, since focusing an action shows the bar.
    <div
      {...props}
      className={className === undefined ? FRAME : `${FRAME} ${className}`}
      data-actions-shown={actionsShown ? "true" : undefined}
      onClick={revealActionsOnTap ? tap : undefined}
    />
  );
}

/**
 * The actions on a turn, set in the line under it (`MessageLine`) beside who
 * sent it and when. Hidden, the bar takes no pointer, so the words above it
 * stay selectable.
 */
export function MessageActions({ children }: { children?: ReactNode }): React.JSX.Element {
  return <div className={ACTIONS}>{children}</div>;
}
