import type { ReactNode } from "react";

export const BLOCK_LIST_ELEMENT = {
  UL: "ul",
  OL: "ol",
} as const;

export type BlockListElement = (typeof BLOCK_LIST_ELEMENT)[keyof typeof BLOCK_LIST_ELEMENT];

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
    <Element className="ui-block-list" aria-label={label}>
      {children}
    </Element>
  );
}

export function BlockListItem({ children }: { children: ReactNode }): React.JSX.Element {
  return <li className="ui-block-list-item">{children}</li>;
}
