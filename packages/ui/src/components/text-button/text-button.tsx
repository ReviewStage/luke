import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

/**
 * text-button.tsx -- a press drawn as words among words: a link's look on a button, for an act that stays in the window.
 *
 * A text button is a `<button>`, since what it does is an act here (open a
 * thread, show a list, cancel a wait) rather than a page to follow, yet it
 * stands inside a line of text, so it takes the words' own size and weight
 * and no box of its own. Its tone says how it reads at rest:
 *
 * - `quiet` in the words' own ink, underlined only under the pointer or the
 *   keyboard, for words that already read as the act (a name, an "Edited"
 *   line, a count);
 * - `link` in the words' own ink over a faint underline that goes full
 *   strength under the pointer or the keyboard, as a written link is drawn,
 *   for an act nothing else around it says is pressable ("Send feedback");
 * - `accent` in the accent's ink, set as a label, for the one act a line
 *   offers ("3 replies").
 *
 * It never wraps: words longer than its room end in an ellipsis. It takes no
 * class or style, and its outer spacing is its container's. One that keeps
 * focus (`keepFocus`) leaves the focus where it is when a pointer presses
 * it, as a Button's does, and an app's hint wraps it as it wraps a Button,
 * handing it the pointer and focus handlers it shows and goes on.
 */

/** How a text button reads at rest. */
export const TEXT_BUTTON_TONE = {
  QUIET: "quiet",
  LINK: "link",
  ACCENT: "accent",
} as const;

export type TextButtonTone = (typeof TEXT_BUTTON_TONE)[keyof typeof TEXT_BUTTON_TONE];

/** What an app's hint hands the button it wraps: when to show and go, and the chord it names. */
type HintProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerDown"
  | "onFocus"
  | "onBlur"
  | "aria-describedby"
  | "aria-keyshortcuts"
>;

/** A pointer's press that leaves the focus where it is. */
function preventFocusMove(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/** Words in a line that act when pressed, drawn in `tone`. */
export function TextButton({
  tone = TEXT_BUTTON_TONE.QUIET,
  onClick,
  keepFocus,
  id,
  children,
  ...props
}: HintProps & {
  tone?: TextButtonTone;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Whether a pointer's press leaves the focus where it is. */
  keepFocus?: boolean | undefined;
  id?: string | undefined;
  /** Its accessible name, where the words on screen say less than the act. */
  "aria-label"?: string | undefined;
  /** The region it shows and hides, and whether that stands open. */
  "aria-expanded"?: boolean | undefined;
  "aria-controls"?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="luke-text-button"
      data-tone={tone}
      id={id}
      aria-label={props["aria-label"]}
      aria-expanded={props["aria-expanded"]}
      aria-controls={props["aria-controls"]}
      aria-describedby={props["aria-describedby"]}
      aria-keyshortcuts={props["aria-keyshortcuts"]}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      onPointerDown={props.onPointerDown}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      // Note that the focus moves as a mousedown's default, so refusing it there is what keeps it.
      onMouseDown={keepFocus === true ? preventFocusMove : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
