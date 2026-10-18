import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { useClipped } from "../../use-clipped.js";

/**
 * clipped-line.tsx -- a line of words held to one line, measured for whether its box cuts it short, which `OneLine` and a hover card's one-line name and note are drawn from.
 */

/** How a line cut short ends: in an ellipsis, or fading out over its last few pixels as a browser's tab does. */
export const ONE_LINE_END = {
  ELLIPSIS: "ellipsis",
  FADE: "fade",
} as const;

export type OneLineEnd = (typeof ONE_LINE_END)[keyof typeof ONE_LINE_END];

/** The elements a line may be drawn as: words in a row, a name, a detail under it, or a paragraph. */
export const ONE_LINE_ELEMENT = {
  SPAN: "span",
  STRONG: "strong",
  SMALL: "small",
  P: "p",
} as const;

export type OneLineElement = (typeof ONE_LINE_ELEMENT)[keyof typeof ONE_LINE_ELEMENT];

/** The app's hint over a line: the line it hangs from, which takes the hint's handlers, and whether its words are cut short. */
export type OneLineHint = (
  line: ReactElement<HTMLAttributes<HTMLElement>>,
  clipped: boolean,
) => ReactElement;

/** A line held to one line, in `className` beside the shared one, its hint hung where one is given. */
export function ClippedLine({
  className,
  as: Element,
  end,
  hint,
  children,
}: {
  className?: string;
  as: OneLineElement;
  end: OneLineEnd;
  hint?: OneLineHint | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const [measured, clipped] = useClipped();
  const line = (
    <Element
      ref={measured}
      className={className === undefined ? "luke-one-line" : `luke-one-line ${className}`}
      data-end={end}
      data-overflow={String(clipped)}
    >
      {children}
    </Element>
  );
  return hint === undefined ? line : hint(line, clipped);
}
