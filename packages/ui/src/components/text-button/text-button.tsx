import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { cn } from "../../cn.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { useLinkAddress } from "../menu/link-address.js";

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
 * It keeps to one line unless asked for two (`lines`), as a card's name
 * wraps: words longer than that end in an ellipsis. Words too short to want
 * cutting, a time, may be asked whole: on a coarse pointer those lift the
 * clip and take a finger's press wider and taller than they are, which the
 * clip of words that can be cut would cut short. It takes no
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

/** How many lines its words take before they are cut short with an ellipsis. */
export const TEXT_BUTTON_LINES = {
  ONE: "one",
  TWO: "two",
  /** Too short to want cutting, so on a coarse pointer its press reaches past its words. */
  WHOLE: "whole",
} as const;

export type TextButtonLines = (typeof TEXT_BUTTON_LINES)[keyof typeof TEXT_BUTTON_LINES];

/**
 * Words with no box of their own, in the line's own type and ink: a
 * hairline corner, so the keyboard's ring hugs them, and a glyph after them
 * (a disclosure's chevron) set to their size. Note that a clip, unlike a
 * hidden overflow, keeps the words' own baseline, so the press sits on the
 * line it stands in.
 */
const TEXT =
  "luke-text-button align-baseline min-w-0 max-w-full m-0 p-0 [border:0] rounded-[2px] bg-transparent bg-none text-inherit [font:inherit] text-start no-underline decoration-1 underline-offset-[0.24em] text-ellipsis cursor-pointer in-data-[luke-profile=desktop]:cursor-default transition-[color,text-decoration-color] duration-(--luke-duration-hover) ease-[ease] [&_svg]:size-[0.8em] [&_svg]:ms-0.5 [&_svg]:align-[-0.05em]";

/**
 * How many lines the words take. One is cut with an ellipsis; two wrap
 * and cut a third short, a card's name; whole, too short to want cutting
 * (a time), takes on a coarse pointer a press a finger's height, and at
 * least as wide, centred on the words, as a Button's is, its clip lifted
 * so it does not clip the press.
 */
const TEXT_LINES = {
  one: "inline-block overflow-clip whitespace-nowrap",
  two: "[display:-webkit-inline-box] overflow-hidden wrap-anywhere whitespace-normal [-webkit-box-orient:vertical] [-webkit-line-clamp:2]",
  whole:
    "inline-block overflow-clip whitespace-nowrap pointer-coarse:relative pointer-coarse:overflow-visible pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:w-[max(100%,var(--luke-touch-target))] pointer-coarse:before:h-touch pointer-coarse:before:[transform:translate(-50%,-50%)] pointer-coarse:before:content-['']",
} as const satisfies Record<TextButtonLines, string>;

/**
 * How each tone reads: quiet, in the line's ink until the pointer or the
 * keyboard underlines it in the full ink; a link, underlined faintly and
 * fully under the pointer or the keyboard; the accent, in the accent's ink
 * and a label's weight. Note that a state here is a selector of its own
 * rather than Tailwind's `hover:`, which a touch screen never answers, and
 * that the accent's weight is keyed on its tone, which outweighs the box's
 * `font: inherit`.
 */
const TEXT_TONE = {
  quiet: "[&:is(:hover,:focus-visible)]:text-foreground [&:is(:hover,:focus-visible)]:underline",
  link: "underline decoration-[color-mix(in_srgb,currentColor_32%,transparent)] [&:is(:hover,:focus-visible)]:decoration-current",
  accent: "text-accent-ink data-[tone=accent]:font-medium [&:is(:hover,:focus-visible)]:underline",
} as const satisfies Record<TextButtonTone, string>;

/** A pointer's press that leaves the focus where it is. */
function preventFocusMove(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/** Words in a line that act when pressed, drawn in `tone`. */
export function TextButton({
  tone = TEXT_BUTTON_TONE.QUIET,
  lines = TEXT_BUTTON_LINES.ONE,
  onClick,
  keepFocus,
  id,
  linkHref,
  children,
  ...props
}: HintProps & {
  tone?: TextButtonTone;
  lines?: TextButtonLines;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Whether a pointer's press leaves the focus where it is. */
  keepFocus?: boolean | undefined;
  id?: string | undefined;
  /** The address its press opens, where it opens one, which a right-click offers as a link's (`useLinkAddress`). */
  linkHref?: string | undefined;
  /** Its accessible name, where the words on screen say less than the act. */
  "aria-label"?: string | undefined;
  /** The region it shows and hides, and whether that stands open. */
  "aria-expanded"?: boolean | undefined;
  "aria-controls"?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const linkAddress = useLinkAddress(linkHref);
  return (
    <ButtonPrimitive
      type="button"
      className={cn(TEXT, TEXT_LINES[lines], TEXT_TONE[tone])}
      data-tone={tone}
      data-lines={lines}
      ref={linkAddress}
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
      onClick={pulseOnPress(onClick, PRESS_PULSE.WORDS)}
    >
      {children}
    </ButtonPrimitive>
  );
}
