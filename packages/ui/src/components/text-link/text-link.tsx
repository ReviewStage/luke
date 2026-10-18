import type { MouseEvent, ReactNode } from "react";
import { ExternalIcon } from "../../face/glyphs.js";
import type { TextVariant } from "../text/text.js";

/**
 * text-link.tsx -- a link drawn as words: muted until the pointer or the reader's place lifts it, or underlined in a line of words.
 *
 * A look says where the link stands: `quiet` for one among the chrome a
 * reader moves by (a site's navigation, a footer's row, a way back), muted
 * and lifting to the text's own ink under the pointer and where the reader
 * already is (`current`); `underlined` for one inside a sentence, in the
 * words' own ink and marked as a link by its underline.
 *
 * A link set in a type role (`variant`) wears that role's size, leading,
 * and weight; one set in none takes the words around it, so a footer's mono
 * caption row or a card's sentence keeps its own type. A link that stands
 * alone at the control's `height` is as tall as a control, so a finger's
 * target is the contract's without moving a word.
 *
 * An `external` link opens in a new tab, says so with a glyph after its
 * words, and tells the page it opens nothing of the opener's. A link takes
 * no class or style: its outer spacing is its container's.
 */

/** Where a link stands, which is how it looks. */
export const TEXT_LINK_LOOK = {
  QUIET: "quiet",
  UNDERLINED: "underlined",
} as const;

export type TextLinkLook = (typeof TEXT_LINK_LOOK)[keyof typeof TEXT_LINK_LOOK];

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

/** Words going to `href`, quiet unless asked, in the surrounding type unless set in a role. */
export function TextLink({
  href,
  look = TEXT_LINK_LOOK.QUIET,
  variant,
  height = TEXT_LINK_HEIGHT.TEXT,
  current,
  external = false,
  onClick,
  children,
}: {
  href: string;
  look?: TextLinkLook;
  /** The type role its words are set in; the surrounding words' type where none. */
  variant?: TextVariant | undefined;
  height?: TextLinkHeight;
  /** Whether the reader is where it goes, which lifts a quiet link and is announced. */
  current?: TextLinkCurrent | undefined;
  /** Whether it opens in a new tab, which a glyph after its words says. */
  external?: boolean;
  /** Called as the press leaves, before the browser follows the link. */
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <a
      className="luke-text-link"
      data-look={look}
      data-variant={variant}
      data-height={height}
      href={href}
      aria-current={current}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      onClick={onClick}
    >
      {children}
      {external ? <ExternalIcon /> : null}
    </a>
  );
}
