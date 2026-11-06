import { createContext, useContext } from "react";

/**
 * page-scroller.ts -- the element a page scrolls its content in, handed down to what draws only the part of itself in view.
 *
 * A page owns its scroll boundary (`page-frame.ts`), so what stands in its
 * content and draws only the rows near the view, as `DataTable` does, asks
 * the page which element scrolls rather than taking a scroller of its own.
 * The answer is read each time it is asked, because which element scrolls
 * may change with the room: a detail page's columns scroll on their own in a
 * wide pane and its body scrolls them as one in a narrow one.
 */

/** Answers the element that scrolls the content, none outside a page. */
type PageScroller = () => HTMLElement | null;

const NO_SCROLLER: PageScroller = () => null;

export const PageScrollerContext = createContext<PageScroller>(NO_SCROLLER);

/** The element the page around the caller scrolls its content in, as it stands when asked. */
export function usePageScroller(): PageScroller {
  return useContext(PageScrollerContext);
}
