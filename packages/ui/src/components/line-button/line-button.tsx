import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { cn } from "../../cn.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { useDisclosureState, useDisclosureSummaryClick } from "../disclosure/disclosure.js";

/**
 * line-button.tsx -- a press as wide as its column and one line tall, drawn as the words it holds: a call's line that opens what it names, or a quote that shows its words.
 *
 * A line button is a `<button>` for a line that acts as a whole: a
 * transcript's call or subagent that opens its tab, or a comment's quote
 * that shows its words in the plan. A line summary is the same line as the
 * `summary` of a fold (`Disclosure`, or an app's own skin over
 * `useDisclosureFold`), which opens and closes it, says whether it stands
 * open in `aria-expanded`, and takes Enter and Space as the platform's own
 * disclosure control does. Its look says what the line is:
 *
 * - `row` a call's row: the caption's type in the muted ink, a fill under
 *   the pointer and a deeper one under the press, its glyph and words set
 *   in by a hairline inset, and a finger's height on a touch screen. One
 *   whose every word is muted `brightens`, its words coming up to the full
 *   ink under the pointer, where a row whose name is already in the full
 *   ink keeps the rest of its words muted;
 * - `quote` a quoted passage, in its container's own type and ink, up to two
 *   lines and cut short after, its ink coming up under the pointer and
 *   fading back under the press;
 * - `band` a strip across a card, flush to its edges: its container's own
 *   type and ink, square at its ends, filled faintly under the pointer and
 *   its words underlined in the full ink under the pointer or the keyboard,
 *   as a link's are, as a review card's line naming the file and lines it
 *   is on.
 *
 * The caller draws what stands in the line (a glyph, its words, a state
 * mark) with its own classes, and the line lays them out in a row. It takes
 * no class or style, and its outer spacing is its container's; a caller
 * that finds its line by a mark of its own hands it as a `data-` attribute.
 * An app's hint wraps it as it wraps a Button, handing it the pointer, touch,
 * and focus handlers it shows and goes on.
 */

/** What a line is, which is how it is drawn. */
export const LINE_BUTTON_LOOK = {
  ROW: "row",
  QUOTE: "quote",
  BAND: "band",
} as const;

export type LineButtonLook = (typeof LINE_BUTTON_LOOK)[keyof typeof LINE_BUTTON_LOOK];

/**
 * A line's box: its column's width, one line tall, in its container's type
 * and ink, with no box of its own but its look's. Note that a summary draws
 * no marker of its own: a row's chevron, where it has one, is the caller's;
 * and that a glyph keeps its seat however long the words beside it run.
 */
const LINE =
  "luke-line-button flex w-full min-w-0 items-center gap-icon-gap m-0 p-0 [border:0] bg-transparent bg-none text-inherit [font:inherit] text-start list-none select-none cursor-pointer in-data-[luke-profile=desktop]:cursor-default transition-[color,background-color,opacity] duration-(--luke-duration-hover) ease-motion-exit [&::-webkit-details-marker]:hidden [&>svg]:flex-none";

/**
 * Each look's own. A call's row is at least 28px tall (a finger's 44px on a
 * coarse pointer, its words still centred), so a narrow column whose
 * caller lets its words wrap grows the row around them; its words are in
 * the caption's type and the muted ink, held in by a hairline at its ends,
 * lit under the pointer and deeper under the press. A quote is two lines
 * and then cut short, its ink coming up under the pointer and fading back
 * under the press. A band across a card is filled faintly under the
 * pointer, its words coming up to the full ink and underlined under the
 * pointer or the keyboard, as a link's are, so it reads as the way to the
 * lines it names. Note that a state here is a selector of its own rather
 * than Tailwind's `hover:`, which a touch screen never answers, so a tap
 * draws as it did; and that the row's type is keyed on its look, which
 * outweighs the box's `font: inherit`.
 */
const LINE_LOOK = {
  row: "min-h-[28px] pointer-coarse:min-h-touch py-0.5 px-1 rounded-luke-6 text-muted-foreground data-[look=row]:text-caption [&:hover:not(:active)]:bg-fill-strong [&:active]:bg-fill-pressed data-[brightens=true]:[&:hover]:text-foreground",
  quote:
    "line-clamp-2 [line-clamp:2] wrap-anywhere [&:hover]:text-foreground [&:active]:opacity-70",
  band: "decoration-1 underline-offset-[0.24em] [&:hover]:bg-muted [&:is(:hover,:focus-visible)]:text-foreground [&:is(:hover,:focus-visible)]:underline",
} as const satisfies Record<LineButtonLook, string>;

/** What an app's hint hands the line it wraps: when to show and go, and what it says of the line. */
type HintProps = Pick<
  ButtonHTMLAttributes<HTMLElement>,
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerDown"
  | "onTouchEnd"
  | "onFocus"
  | "onBlur"
  | "aria-describedby"
  | "aria-keyshortcuts"
>;

/** The marks a caller finds its line by, as `data-` attributes. */
type DataMarks = { [mark: `data-${string}`]: string | undefined };

/** What both a line button and a line summary take. */
type LineBase = HintProps &
  DataMarks & {
    /** Whether its muted words come up to the full ink under the pointer, for a row whose every word is muted. */
    brightens?: boolean | undefined;
    children: ReactNode;
  };

/** A line that acts when pressed, drawn in `look`. */
export function LineButton({
  look = LINE_BUTTON_LOOK.ROW,
  brightens,
  onClick,
  id,
  children,
  ...props
}: LineBase & {
  look?: LineButtonLook;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  id?: string | undefined;
  /** Its accessible name, where the words on screen say less than the act. */
  "aria-label"?: string | undefined;
  /** The region it shows and hides, and whether that stands open. */
  "aria-expanded"?: boolean | undefined;
  "aria-controls"?: string | undefined;
}): React.JSX.Element {
  return (
    <ButtonPrimitive
      type="button"
      className={cn(LINE, LINE_LOOK[look])}
      data-look={look}
      data-brightens={brightens === true ? true : undefined}
      id={id}
      // Note that a band meets its card's edges, so its press leaves its fill standing.
      onClick={pulseOnPress(
        onClick,
        look === LINE_BUTTON_LOOK.BAND ? PRESS_PULSE.FLUSH : PRESS_PULSE.QUIET,
      )}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  );
}

/** A fold's one line, drawn as a row, which opens and closes the fold around it. */
export function LineSummary({ brightens, children, ...props }: LineBase): React.JSX.Element {
  const { open } = useDisclosureState();
  const toggle = useDisclosureSummaryClick();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a summary is the platform's own disclosure control, focusable and opened by Enter and Space; the click it already takes is routed to React's state.
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a summary is exposed as its details' disclosure button, which takes aria-expanded; the rule's table gives the element no role.
    <summary
      className={cn(LINE, LINE_LOOK.row)}
      data-look={LINE_BUTTON_LOOK.ROW}
      data-brightens={brightens === true ? true : undefined}
      aria-expanded={open}
      onClick={toggle}
      {...props}
    >
      {children}
    </summary>
  );
}
