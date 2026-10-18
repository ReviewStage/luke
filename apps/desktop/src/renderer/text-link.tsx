import { TextLink as SharedTextLink, TEXT_LINK_LOOK } from "@luke/ui";
import { linkFace } from "@luke/ui/link-face";
import type { ReactNode } from "react";
import { opensAsLink } from "./tasks/use-open-link";
import { Tooltip } from "./tooltip";

/**
 * text-link.tsx -- a plain link in written words, drawn one way in every place that draws words: its label underlined quietly in the words' own ink, a bare address cut to its host and path with a small ↗, the whole address in the window's hint.
 *
 * A link the window knows better, a mention, is drawn as its chip
 * (`planning/mention-chip.tsx`) before it ever reaches here; what is left
 * is a page the window has no chip for. Both Markdown renderers draw it
 * through this one element, a transcript's (`planning/transcript-blocks.tsx`)
 * and a plan's (`markdown-message.tsx`), and the plan's editor gives its
 * link mark the same class, so a link reads alike wherever it is written.
 * Where words are their own address (`@luke/ui/link-face`), they say it as
 * a reader names a page, and the ↗ says a press leaves the window, as a
 * chip's press stays in it. What it looks like is `@luke/ui`'s underlined
 * TextLink; what is the window's own is here: the face, the hint, and the
 * press that opens the address through the app rather than the page.
 *
 * A place that opens links hands `onOpen`, and the link is pressed where the
 * window opens its address at all (`opensAsLink`); a press goes no further
 * than the link, so a section's block under it opens no editor. A place
 * that opens none, or an address the window refuses, draws the same words
 * going nowhere. A label that is more than words, one an edit or a
 * version's change marks inside, is drawn as it is and never cut short, so
 * its caret and its marks stay where they stand.
 */

/**
 * The most characters of an address the hint says. Note that an address
 * past it, thousands of characters long, is cut, because a hint taller than
 * the window would stand mostly off it and scrolls nowhere.
 */
const HINT_MAX_CHARS = 500;

/** The address as the hint says it: whole, or cut at the bound and marked. */
function hintOf(href: string): string {
  return href.length <= HINT_MAX_CHARS ? href : `${href.slice(0, HINT_MAX_CHARS - 1)}…`;
}

/** A plain link to `href`: its label as `children`, and its label's words, which say whether it is its own address; no words for a label that is more than words. */
export function TextLink({
  href,
  words,
  children,
  onOpen,
}: {
  href: string;
  words: string | undefined;
  children: ReactNode;
  /** Opens the link; without one, the link is words going nowhere. */
  onOpen?: ((href: string) => void) | undefined;
}): React.JSX.Element {
  const face = words === undefined ? undefined : linkFace(href, words);
  const opens = onOpen !== undefined && opensAsLink(href);
  return (
    <Tooltip label={hintOf(href)}>
      <SharedTextLink
        href={opens ? href : undefined}
        look={TEXT_LINK_LOOK.UNDERLINED}
        external={face?.shortened === true}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen?.(href);
        }}
      >
        {face?.shortened === true ? face.words : children}
      </SharedTextLink>
    </Tooltip>
  );
}
