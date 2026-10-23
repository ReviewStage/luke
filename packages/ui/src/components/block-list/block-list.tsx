import type { ReactNode } from "react";

/**
 * block-list.tsx -- blocks one under another in one box: its hairline and a control's corner round them all, and a hairline between each and the next.
 *
 * A block is what is no row: a comment under the file and lines it is on,
 * with its presses, laid out by what it holds. The list owns the box, the
 * hairlines, and the room inside each block; each block lays its own parts
 * one under another, an item's step apart. It is an `ol` where the order is
 * what it says, as a review's pending comments are, and a `ul` otherwise
 * (`BLOCK_LIST_ELEMENT`), named by `label` for a reader moving between lists.
 */

/** The elements a list of blocks may be: ordered where its order says something, plain otherwise. */
export const BLOCK_LIST_ELEMENT = {
  UL: "ul",
  OL: "ol",
} as const;

export type BlockListElement = (typeof BLOCK_LIST_ELEMENT)[keyof typeof BLOCK_LIST_ELEMENT];

/** Blocks in one box, a hairline between each. */
export function BlockList({
  as: Element = BLOCK_LIST_ELEMENT.UL,
  label,
  children,
}: {
  as?: BlockListElement;
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Element className="luke-block-list" aria-label={label}>
      {children}
    </Element>
  );
}

/** One block of a `BlockList`: its parts one under another. */
export function BlockListItem({ children }: { children: ReactNode }): React.JSX.Element {
  return <li className="luke-block-list-item">{children}</li>;
}
