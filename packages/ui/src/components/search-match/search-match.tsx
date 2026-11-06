import type { ReactNode } from "react";

export const SEARCH_MATCH_CLASS = "search-match rounded-ui-6 bg-match text-inherit";

export function SearchMatch({ children }: { children: ReactNode }): React.JSX.Element {
  return <mark className={SEARCH_MATCH_CLASS}>{children}</mark>;
}
