import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { useClipped } from "../../use-clipped.js";

export const ONE_LINE_END = {
  ELLIPSIS: "ellipsis",
  FADE: "fade",
} as const;

export type OneLineEnd = (typeof ONE_LINE_END)[keyof typeof ONE_LINE_END];

export const ONE_LINE_ELEMENT = {
  H1: "h1",
  H2: "h2",
  SPAN: "span",
  STRONG: "strong",
  SMALL: "small",
  P: "p",
  CODE: "code",
} as const;

export type OneLineElement = (typeof ONE_LINE_ELEMENT)[keyof typeof ONE_LINE_ELEMENT];

export type OneLineHint = (
  line: ReactElement<HTMLAttributes<HTMLElement>>,
  clipped: boolean,
) => ReactElement;

export function ClippedLine({
  className,
  as: Element,
  end,
  hint,
  words,
  children,
}: {
  className?: string;
  as: OneLineElement;
  end: OneLineEnd;
  hint?: OneLineHint | undefined;
  words?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const [measured, clipped] = useClipped(words);
  const line = (
    <Element
      ref={measured}
      className={className === undefined ? "ui-one-line" : `ui-one-line ${className}`}
      data-end={end}
      data-overflow={String(clipped)}
    >
      {children}
    </Element>
  );
  return hint === undefined ? line : hint(line, clipped);
}
