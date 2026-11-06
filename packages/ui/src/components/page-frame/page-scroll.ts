import { createContext, type RefObject, useContext } from "react";

/**
 * page-scroll.ts -- the element a page scrolls its content in, and the box whose resizing moves what stands in it, handed down to what draws only the part of itself in view.
 *
 * A page owns its scroll boundary (`page-frame.ts`), so a long list or table
 * standing in its content that draws only the rows near the view
 * (`VirtualRows`, `DataTable`) reads the page's scroller rather than taking
 * one of its own, with the box of content whose resizing moves where the
 * rows stand in it (`VirtualRows`' `shiftedBy`), so the rows read their
 * place again as what stands above them grows or shrinks. A settings page,
 * a detail page, and a collection page each provide it around their content.
 */

/** The page's scroller and its box of content, as a list drawing only the rows near the view reads them (`VirtualRows`' `scroller` and `shiftedBy`). */
export interface PageScroll {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly shiftedBy: RefObject<HTMLElement | null>;
}

/** No page: a list outside one finds no scroller, as a scroller not yet drawn is none. */
const NO_PAGE: PageScroll = { scroller: { current: null }, shiftedBy: { current: null } };

export const PageScrollContext = createContext<PageScroll>(NO_PAGE);

/** The scroller of the page the caller stands on, and its box of content. */
export function usePageScroll(): PageScroll {
  return useContext(PageScrollContext);
}
