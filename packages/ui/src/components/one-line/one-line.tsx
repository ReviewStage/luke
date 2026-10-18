/**
 * one-line.tsx -- words held to one line, ending in an ellipsis or a fade where their box cuts them short, and a hint reading them whole while it does.
 *
 * An address, a name, or a title has nowhere to wrap well, so in a narrow row
 * it would run under the control beside it or out of its card. Held to one
 * line it ends in an ellipsis instead, or fades out over its last few pixels
 * as a browser's tab does, and only then does its hint say it whole: a line
 * drawn whole says nothing twice. The hint is the app's, since when a hint
 * shows is the app's (the desktop's `Tooltip`): it is handed the line and
 * whether it is cut short, and hangs from the line it returns. The words
 * ride the hint rather than a `title`, which a session recording would
 * carry unmasked.
 */

import type { ReactNode } from "react";
import {
  ClippedLine,
  ONE_LINE_ELEMENT,
  ONE_LINE_END,
  type OneLineElement,
  type OneLineEnd,
  type OneLineHint,
} from "./clipped-line.js";

export { ONE_LINE_ELEMENT, ONE_LINE_END, type OneLineElement, type OneLineEnd, type OneLineHint };

/** Words on one line, cut short at `end` where their box ends, with `hint` hung over them while they are. */
export function OneLine({
  as = ONE_LINE_ELEMENT.SPAN,
  end = ONE_LINE_END.ELLIPSIS,
  hint,
  children,
}: {
  /** The element the line is drawn as: a row's name (`strong`), its detail (`small`), or words in a row (`span`). */
  as?: OneLineElement;
  end?: OneLineEnd;
  /** The app's hint over the line, which says its words whole while they are cut short. */
  hint?: OneLineHint | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ClippedLine as={as} end={end} hint={hint}>
      {children}
    </ClippedLine>
  );
}
