/**
 * one-line.tsx -- words held to one line, fading out or ending in an ellipsis where their box cuts them short, and a hint reading them whole while it does.
 *
 * An address, a name, or a title has nowhere to wrap well, so in a narrow row
 * it would run under the control beside it or out of its card. Held to one
 * line it fades out over its last few pixels as a browser's tab does, or
 * ends in an ellipsis where its caller asks (`end`), and only then does its
 * hint say it whole: a line drawn whole says nothing twice. The hint is the
 * app's, since when a hint shows is the app's (the desktop's `Tooltip`): it
 * is handed the line and whether it is cut short, and hangs from the line it
 * returns, and where a caller gives none it is the window's own tooltip
 * (`wholeWordsHint`), so a name cut short in any row can be read whole. The
 * words ride the hint rather than a `title`, which a session recording would
 * carry unmasked.
 */

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

/** Words on one line, cut short at `end` where their box ends, with `hint` (the window's tooltip, where none is given) hung over them while they are. */
export function OneLine({
  as = ONE_LINE_ELEMENT.SPAN,
  end = ONE_LINE_END.FADE,
  hint,
  className,
  words,
  children,
}: {
  /** The element the line is drawn as: a row's name (`strong`), its detail (`small`), or words in a row (`span`). */
  as?: OneLineElement;
  /** How the line ends while it is cut short: fading out, as a browser's tab does, where none is said. */
  end?: OneLineEnd;
  /** The hint over the line, which says its words whole while they are cut short: the window's tooltip where none is given and the words are a string. */
  hint?: OneLineHint | undefined;
  /** A hook for the caller's own layout and type beside the shared class. */
  className?: string | undefined;
  /** The words as one string where `children` draws them as a tree (a glyph before them), measured as they change; `children` itself where it is a string. */
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
