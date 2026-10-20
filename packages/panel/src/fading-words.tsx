/**
 * fading-words.tsx -- a line of words in a box of its own, marked `data-overflow` while the box cuts it short, which the desktop's stylesheet fades out over its last `--label-fade` rather than ending in an ellipsis.
 *
 * Chrome's and Arc's tabs end a long title by fading its last letters out,
 * which keeps every letter that shows legible and lets a cut name read on
 * into the gap, where an ellipsis spends three dots of the room on saying it
 * was cut. Only a line measured cut short fades (`useClipped`), so a short
 * one ends on its last letter: a mask laid on a box that sizes to its words
 * would eat them. A line drawn from one string hands it as `words`, so a
 * rename is measured in the render that draws it; one drawn as a tree, a
 * search's marks or a time that ticks, hands none and is watched instead.
 */

import { useClipped } from "@luke/ui/use-clipped";
import type { HTMLAttributes, ReactNode } from "react";

/** The elements a fading line is drawn as: words in a row, a page's or a pane's heading, or a name in the code face. */
export const FADING_ELEMENT = {
  SPAN: "span",
  H1: "h1",
  H2: "h2",
  CODE: "code",
} as const;

export type FadingElement = (typeof FADING_ELEMENT)[keyof typeof FADING_ELEMENT];

/** `words` in `className`'s box, or `children` where they draw the words otherwise, fading at the box's end while it cuts them short. */
export function FadingWords({
  as: Element = FADING_ELEMENT.SPAN,
  words,
  children,
  ...attributes
}: {
  as?: FadingElement;
  /** The words drawn, where they are one string; leave out for a tree the hook cannot compare. */
  words?: string | undefined;
  /** What is drawn in the words' place, a search's marks over them or a tree of its own. */
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children">): React.JSX.Element {
  const [measured, clipped] = useClipped(words);
  return (
    <Element ref={measured} {...attributes} data-overflow={String(clipped)}>
      {children ?? words}
    </Element>
  );
}
