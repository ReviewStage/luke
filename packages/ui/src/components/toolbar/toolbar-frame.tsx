/**
 * toolbar-frame.tsx -- the window bar's own box: the banner, its height, and the inset at each of its edges, with whatever a bar lays inside it.
 *
 * `Toolbar` draws its slots in it, and `PageToolbar` its callers' own
 * parts until they move onto `Toolbar`, so the two are one bar to the
 * window. It is no door of the barrel's: a page draws `Toolbar`, never a
 * frame it fills by hand.
 */

import type { ReactNode, Ref } from "react";

/** How far in from a bar's edge its first or last thing stands. */
export const TOOLBAR_INSET = {
  /** Where its column's words start: a page's title, or its last action where words end the bar. */
  PAGE: "page",
  /** At the column's own edge, where a control's fill starts: a way back, a tab strip, crumbs drawn as tabs. */
  COLUMN: "column",
} as const;

export type ToolbarInset = (typeof TOOLBAR_INSET)[keyof typeof TOOLBAR_INSET];

/** How a bar lays its slots. */
export const TOOLBAR_LOOK = {
  /** The window's bar: its lead, its heading taking the room left, and its actions at the end. */
  WINDOW: "window",
  /** A phone's: one control a corner and the title centred between them, however wide each corner's control. */
  PHONE: "phone",
  /** A tab strip's: the strip leads the bar, and a narrow room wraps it to a row of its own under the actions. */
  TABS: "tabs",
} as const;

export type ToolbarLook = (typeof TOOLBAR_LOOK)[keyof typeof TOOLBAR_LOOK];

/** The bar's banner, inset at each edge as named, holding `children` as they are laid. */
export function ToolbarFrame({
  start = TOOLBAR_INSET.PAGE,
  end = TOOLBAR_INSET.PAGE,
  look = TOOLBAR_LOOK.WINDOW,
  place,
  measure = false,
  folded = false,
  wrapHeading = false,
  wrapped = false,
  frameRef,
  children,
}: {
  start?: ToolbarInset | undefined;
  end?: ToolbarInset | undefined;
  look?: ToolbarLook | undefined;
  place?: string | undefined;
  measure?: boolean | undefined;
  folded?: boolean | undefined;
  wrapHeading?: boolean | undefined;
  wrapped?: boolean | undefined;
  frameRef?: Ref<HTMLElement> | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <header
      ref={frameRef}
      className={place === undefined ? "luke-toolbar" : `luke-toolbar ${place}-head`}
      data-start={start}
      data-end={end}
      data-look={look}
      data-measure={measure ? "true" : undefined}
      data-folded={folded ? "true" : undefined}
      data-wrap-heading={wrapHeading ? "true" : undefined}
      data-wrapped={wrapped ? "true" : undefined}
    >
      {children}
    </header>
  );
}
