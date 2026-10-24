/**
 * page-toolbar.tsx -- the window's bar as its pages drew it before `Toolbar`: what leads it as it is, the page's heading in its box, and the page's actions at its end.
 *
 * It is `Toolbar`'s own bar (`ToolbarFrame`), so it draws as `Toolbar`
 * does, but it lays the parts it is handed as they were laid before: `lead`
 * stands first unboxed, since a caller's lead may draw its own heading box
 * (a tab strip, crumbs and a title), and `heading` and `actions` each stand
 * in their own box only where they are given, so an empty heading still
 * holds the strip's middle. Its callers move onto `Toolbar`, whose slots
 * draw those boxes for them, and it goes with the last of them.
 */

import type { ReactNode } from "react";
import { ToolbarFrame } from "../toolbar/toolbar-frame.js";

export function PageToolbar({
  lead,
  heading,
  actions,
}: {
  /** What stands first, as it is: a way back, or a strip that draws its own heading. */
  lead?: ReactNode;
  /** The page's heading, in the strip's heading box; none draws no box. */
  heading?: ReactNode;
  /** The page's actions, at the strip's end; none draws no box. */
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <ToolbarFrame>
      {lead}
      {heading === undefined ? null : (
        <div className="luke-toolbar-heading desktop-toolbar-heading">{heading}</div>
      )}
      {actions === undefined ? null : (
        <div className="luke-toolbar-actions desktop-toolbar-actions">{actions}</div>
      )}
    </ToolbarFrame>
  );
}
