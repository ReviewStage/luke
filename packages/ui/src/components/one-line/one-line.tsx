import type { ReactNode } from "react";
import { wholeWordsHint } from "../tooltip/hint.js";
import {
  ClippedLine,
  ONE_LINE_ELEMENT,
  ONE_LINE_END,
  type OneLineElement,
  type OneLineEnd,
  type OneLineHint,
} from "./clipped-line.js";

export { ONE_LINE_ELEMENT, ONE_LINE_END, type OneLineElement, type OneLineEnd, type OneLineHint };

export function OneLine({
  as = ONE_LINE_ELEMENT.SPAN,
  end = ONE_LINE_END.FADE,
  hint,
  className,
  words,
  children,
}: {
  as?: OneLineElement;
  end?: OneLineEnd;
  hint?: OneLineHint | undefined;
  className?: string | undefined;
  words?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const whole = words ?? (typeof children === "string" ? children : undefined);
  return (
    <ClippedLine
      as={as}
      end={end}
      hint={hint ?? (whole === undefined ? undefined : wholeWordsHint(whole))}
      {...(className === undefined ? {} : { className })}
      words={whole}
    >
      {children}
    </ClippedLine>
  );
}
