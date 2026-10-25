/**
 * text-link.tsx -- a link drawn as words: muted until the pointer or the reader's place lifts it, or underlined in a line of words.
 *
 * A look says where the link stands: `quiet` for one among the chrome a
 * reader moves by (a site's navigation, a footer's row, a way back), muted
 * and lifting to the text's own ink under the pointer and where the reader
 * already is (`current`); `underlined` for one inside written words, in the
 * words' own ink over a thin underline in a faint wash of it, which goes
 * full strength under the pointer or the keyboard, so it reads by its line
 * and not its colour alone; `heading` for one that is a heading's own words
 * (a release's version over its notes), in the text's own ink and lighting
 * to the accent under the pointer.
 *
 * A link set in a type role (`variant`) wears that role's size, leading,
 * and weight, and its `font` the shared sans or mono face; one set in no
 * role takes the words around it, so a footer's mono caption row or a
 * reply's sentence keeps its own type. A link that stands
 * alone at the control's `height` is as tall as a control, so a finger's
 * target is the contract's without moving a word.
 *
 * An `external` link wears a small ↗ after its words, which says a press
 * leaves the place, and lights under the pointer with the link; one that
 * opens in a `newTab` tells the page it opens nothing of the opener's. A
 * link with no `href` is the same words going nowhere, for a place that
 * opens no links or an address it refuses. A link takes no class or style:
 * its outer spacing is its container's.
 *
 * An app's hint wraps a link and hands it the pointer and focus handlers it
 * shows and goes on (`HintProps`), which land on the link itself.
 *
 * It is drawn in the Tailwind theme's utilities, its role's from the table
 * `Text` reads (`text-role.ts`), on a hairline corner so the keyboard's
 * ring, the app's reset's as for every control, hugs the words. Only a link
 * with an address lifts under the pointer or where the reader is, and in an
 * editor it keeps the caret's cursor, since there it is words being written.
 */

import type { FocusEventHandler, MouseEvent, PointerEventHandler, ReactNode } from "react";
import { ArrowUpRightIcon } from "../../face/glyphs.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { TEXT_FONT, type TextFont } from "../text/text.js";
import { TEXT_ROLE_CLASS, TEXT_VARIANT, type TextVariant } from "../text/text-role.js";
import { TEXT_LINK_LOOK, type TextLinkLook } from "./text-link-look.js";

export { TEXT_LINK_LOOK, type TextLinkLook } from "./text-link-look.js";

/** How tall a link stands: its words' own line, or a control's height. */
export const TEXT_LINK_HEIGHT = {
  TEXT: "text",
  CONTROL: "control",
} as const;

export type TextLinkHeight = (typeof TEXT_LINK_HEIGHT)[keyof typeof TEXT_LINK_HEIGHT];

/** Where the reader is, said of a link: on the page it goes to, or in the part of the site it opens. */
export const TEXT_LINK_CURRENT = {
  PAGE: "page",
  SECTION: "true",
} as const;

export type TextLinkCurrent = (typeof TEXT_LINK_CURRENT)[keyof typeof TEXT_LINK_CURRENT];

/** What an app's hint hands the link it wraps: when to show and go, and the words it describes it by. */
/** What every link is drawn with: its corner, its words broken anywhere, its ink and underline easing under the pointer; the ↗'s group (`ArrowUpRightIcon`). */
const LINK_BASE =
  "luke-text-link group/text-link rounded-text-link wrap-anywhere transition-[color,text-decoration-color] duration-(--luke-duration-hover) ease-motion-exit";

/** Each look's ink at rest and, where `a` lifts under the pointer or where the reader is, lit: an underlined link keeps its words' ink, its line going full strength. */
const LOOK_CLASS = {
  [TEXT_LINK_LOOK.QUIET]: {
    rest: "text-muted-foreground no-underline",
    lit: "[&:hover]:text-foreground [&[aria-current]]:text-foreground",
  },
  [TEXT_LINK_LOOK.UNDERLINED]: {
    rest: "text-inherit underline decoration-link-underline decoration-1 underline-offset-[0.24em] [&:is(:hover,:focus-visible)]:decoration-current",
    lit: "",
  },
  [TEXT_LINK_LOOK.HEADING]: {
    rest: "text-foreground no-underline",
    lit: "[&:hover]:text-accent-ink",
  },
} as const satisfies Record<TextLinkLook, { rest: string; lit: string }>;

/** The face a link's words are set in, where it asks for one. */
const FONT_CLASS = {
  [TEXT_FONT.SANS]: "font-ui",
  [TEXT_FONT.MONO]: "font-mono",
} as const satisfies Record<TextFont, string>;

/** A link as tall as a control, its words on its middle. */
const CONTROL_HEIGHT = "inline-flex items-center min-h-control";

/** The classes a link of `look`, `variant`, `font`, and `height` is drawn in, with an address (`linked`) or none. */
function linkClass(
  look: TextLinkLook,
  variant: TextVariant | undefined,
  font: TextFont | undefined,
  height: TextLinkHeight,
  linked: boolean,
): string {
  const { rest, lit } = LOOK_CLASS[look];
  return [
    LINK_BASE,
    rest,
    linked ? `cursor-link in-[[contenteditable]]:cursor-text ${lit}` : undefined,
    font === undefined ? undefined : FONT_CLASS[font],
    height === TEXT_LINK_HEIGHT.CONTROL ? CONTROL_HEIGHT : undefined,
    variant === undefined || variant === TEXT_VARIANT.INHERIT
      ? undefined
      : TEXT_ROLE_CLASS[variant],
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
}

type HintProps = {
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
  "aria-describedby"?: string | undefined;
};

/** Words going to `href`, quiet unless asked, in the surrounding type unless set in a role. */
export function TextLink({
  href,
  look = TEXT_LINK_LOOK.QUIET,
  variant,
  font,
  height = TEXT_LINK_HEIGHT.TEXT,
  current,
  external = false,
  newTab = false,
  onClick,
  children,
  ...hint
}: HintProps & {
  /** Where it goes; without one, the words go nowhere and are no link. */
  href: string | undefined;
  look?: TextLinkLook;
  /** The type role its words are set in; the surrounding words' type where none. */
  variant?: TextVariant | undefined;
  /** The face its words are set in; the surrounding words' face where none. */
  font?: TextFont | undefined;
  height?: TextLinkHeight;
  /** Whether the reader is where it goes, which lifts a quiet link and is announced. */
  current?: TextLinkCurrent | undefined;
  /** Whether a press leaves the place, which a ↗ after its words says. */
  external?: boolean;
  /** Whether it opens in a new tab. */
  newTab?: boolean;
  /** Called as the press leaves, before the browser follows the link. */
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const words = (
    <>
      {children}
      {external ? <ArrowUpRightIcon /> : null}
    </>
  );
  const face = {
    "data-look": look,
    "data-variant": variant,
    "data-font": font,
    "data-height": height,
  };
  if (href === undefined) {
    return (
      <span className={linkClass(look, variant, font, height, false)} {...face} {...hint}>
        {words}
      </span>
    );
  }
  return (
    <a
      className={linkClass(look, variant, font, height, true)}
      {...face}
      {...hint}
      href={href}
      aria-current={current}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
      onClick={pulseOnPress(onClick, PRESS_PULSE.WORDS)}
    >
      {words}
    </a>
  );
}
