import type { ReactNode } from "react";

/**
 * search-match.tsx -- the words a search's query landed on, marked in a line so a result says why it matched.
 *
 * A wash rather than the engine's yellow: the mark identifies text, and the
 * line's own colours keep saying everything else. No padding, because these
 * lines cut short, and a mark that widened its words would push the cut
 * around as the query changed. A line drawn as markup rather than by React
 * (a reply's Markdown) marks its words with the same classes
 * (`SEARCH_MATCH_CLASS`), so the two read alike; `search-match` is the hook
 * the window's tests find a mark by.
 */

/** The classes a mark wears, for a mark drawn outside React. */
export const SEARCH_MATCH_CLASS = "search-match rounded-luke-6 bg-match text-inherit";

/** `children`, the words a query landed on, marked. */
export function SearchMatch({ children }: { children: ReactNode }): React.JSX.Element {
  return <mark className={SEARCH_MATCH_CLASS}>{children}</mark>;
}
