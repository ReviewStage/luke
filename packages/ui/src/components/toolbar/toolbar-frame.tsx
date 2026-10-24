/**
 * toolbar-frame.tsx -- the window bar's own box: the banner, its height, and the inset at each of its edges, with whatever a bar lays inside it.
 *
 * `Toolbar` draws its slots in it, and `PageToolbar` its callers' own
 * parts until they move onto `Toolbar`, so the two are one bar to the
 * window. It is no door of the barrel's: a page draws `Toolbar`, never a
 * frame it fills by hand.
 *
 * Each part wears its `luke-toolbar*` class and the window's older
 * `desktop-toolbar*` name beside it, which the panel's own rules for each
 * screen still reach until they are folded into the bar's insets.
 */

import type { ReactNode } from "react";

/** How far in from a bar's edge its first or last thing stands. */
export const TOOLBAR_INSET = {
  /** Where its column's words start: a page's title, or its last action where words end the bar. */
  PAGE: "page",
  /** At the column's own edge, where a control's fill starts: a way back, a tab strip, crumbs drawn as tabs. */
  COLUMN: "column",
} as const;

export type ToolbarInset = (typeof TOOLBAR_INSET)[keyof typeof TOOLBAR_INSET];

/** The bar's banner, inset at each edge as named, holding `children` as they are laid. */
export function ToolbarFrame({
  start = TOOLBAR_INSET.PAGE,
  end = TOOLBAR_INSET.PAGE,
  children,
}: {
  start?: ToolbarInset | undefined;
  end?: ToolbarInset | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="luke-toolbar desktop-toolbar" data-start={start} data-end={end}>
      {children}
    </header>
  );
}
