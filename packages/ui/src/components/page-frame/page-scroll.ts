import { createContext, type RefObject, useContext } from "react";

export interface PageScroll {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly shiftedBy: RefObject<HTMLElement | null>;
}

const NO_PAGE: PageScroll = { scroller: { current: null }, shiftedBy: { current: null } };

export const PageScrollContext = createContext<PageScroll>(NO_PAGE);

export function usePageScroll(): PageScroll {
  return useContext(PageScrollContext);
}
