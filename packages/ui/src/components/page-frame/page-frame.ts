import type { ReactNode } from "react";

/**
 * page-frame.ts -- how a collection's or one thing's page is headed, and how wide its content stands.
 *
 * A page is headed by its own title, an in-page header over its content, or
 * by the window's toolbar, which holds the title and the page's acts above
 * it. Under a toolbar the page draws no title of its own: it stands the
 * caller's toolbar, if handed one, still above its scroll, and names itself
 * by `label`, the words the toolbar's title says. Either way the page owns
 * its content's width, its states, and its scroll boundary.
 *
 * Content stands at the page's measure, or across the whole room for a
 * screen that scrolls sideways, a board of columns.
 */

/** What heads the page: its own title, or the window's toolbar above it. */
export const PAGE_FRAME = {
  PAGE: "page",
  TOOLBAR: "toolbar",
} as const;

export type PageFrame = (typeof PAGE_FRAME)[keyof typeof PAGE_FRAME];

/** How wide the content stands: the page's measure, or the whole room, scrolling sideways past it. */
export const PAGE_WIDTH = {
  MEASURE: "measure",
  FULL: "full",
} as const;

export type PageWidth = (typeof PAGE_WIDTH)[keyof typeof PAGE_WIDTH];

/** A page headed by its own title, the acts at its end. */
type HeadedByPage = {
  frame?: typeof PAGE_FRAME.PAGE;
  /** What the page shows, which names it. */
  title: ReactNode;
  description?: ReactNode;
  /** The page's own acts at the header's end. */
  actions?: ReactNode;
  toolbar?: never;
  label?: never;
};

/** A page headed by the window's toolbar, which holds its title and acts. */
type HeadedByToolbar = {
  frame: typeof PAGE_FRAME.TOOLBAR;
  /** The window's toolbar, stood still above the page's scroll; left out where the window draws it elsewhere. */
  toolbar?: ReactNode;
  /** What the page shows, said to a reader as the region's name: the toolbar's title. */
  label: string;
  title?: never;
  description?: never;
  actions?: never;
};

/** How a page is headed, and how wide its content stands. */
export type PageHeading = (HeadedByPage | HeadedByToolbar) & { width?: PageWidth };
