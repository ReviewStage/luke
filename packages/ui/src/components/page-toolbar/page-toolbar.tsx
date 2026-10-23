/**
 * page-toolbar.tsx -- the strip across the top of a page's column, which is also the window's drag handle: what leads it, the page's heading, and the page's actions at its end.
 *
 * The strip, its heading, and its actions wear the window's own toolbar
 * classes (`desktop-toolbar`, `desktop-toolbar-heading`,
 * `desktop-toolbar-actions`), which the panel's stylesheet lays out and
 * makes the drag region, so every page's strip is drawn by that one sheet.
 * `lead` stands first as it is, a way back or a tab strip that draws its
 * own heading; `heading` and `actions` each stand in their own box, drawn
 * where they are given, so an empty heading still holds the strip's middle.
 */

import type { ReactNode } from "react";

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
    <header className="desktop-toolbar">
      {lead}
      {heading === undefined ? null : <div className="desktop-toolbar-heading">{heading}</div>}
      {actions === undefined ? null : <div className="desktop-toolbar-actions">{actions}</div>}
    </header>
  );
}
