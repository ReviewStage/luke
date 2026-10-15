import { linkFace, TEXT_LINK_CLASS } from "@luke/ui/link-face";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";
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
 * chip's press stays in it.
 *
 * A place that opens links hands `onOpen`, and the link is pressed; a press
 * goes no further than the link, so a section's block under it opens no
 * editor. A place that opens none draws the same words going nowhere.
 */

/** A plain link to `href`: its label as `children`, and its label's words, which say whether it is its own address. */
export function TextLink({
  href,
  words,
  children,
  onOpen,
}: {
  href: string;
  words: string;
  children: ReactNode;
  /** Opens the link; without one, the link is words going nowhere. */
  onOpen?: ((href: string) => void) | undefined;
}): React.JSX.Element {
  const face = linkFace(href, words);
  const said = face.shortened ? (
    <>
      {face.words}
      <ArrowUpRightIcon className="text-link-out" aria-hidden="true" />
    </>
  ) : (
    children
  );
  return (
    <Tooltip label={href}>
      {onOpen === undefined ? (
        <span className={TEXT_LINK_CLASS}>{said}</span>
      ) : (
        <a
          href={href}
          className={TEXT_LINK_CLASS}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpen(href);
          }}
        >
          {said}
        </a>
      )}
    </Tooltip>
  );
}
