import type { FocusEventHandler, MouseEvent, PointerEventHandler, ReactNode } from "react";
import { ArrowUpRightIcon } from "../../face/glyphs.js";
import type { TextVariant } from "../text/text.js";
import { TEXT_LINK_LOOK, type TextLinkLook } from "./text-link-look.js";

export { TEXT_LINK_LOOK, type TextLinkLook } from "./text-link-look.js";

/**
 * text-link.tsx -- a link drawn as words: muted until the pointer or the reader's place lifts it, or underlined in a line of words.
 *
 * A look says where the link stands: `quiet` for one among the chrome a
 * reader moves by (a site's navigation, a footer's row, a way back), muted
 * and lifting to the text's own ink under the pointer and where the reader
 * already is (`current`); `underlined` for one inside written words, in the
 * words' own ink over a thin underline in a faint wash of it, which goes
 * full strength under the pointer or the keyboard, so it reads by its line
 * and not its colour alone.
 *
 * A link set in a type role (`variant`) wears that role's size, leading,
 * and weight; one set in none takes the words around it, so a footer's mono
 * caption row or a reply's sentence keeps its own type. A link that stands
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
 */

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
  const face = { "data-look": look, "data-variant": variant, "data-height": height };
  if (href === undefined) {
    return (
      <span className="luke-text-link" {...face} {...hint}>
        {words}
      </span>
    );
  }
  return (
    <a
      className="luke-text-link"
      {...face}
      {...hint}
      href={href}
      aria-current={current}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
      onClick={onClick}
    >
      {words}
    </a>
  );
}
