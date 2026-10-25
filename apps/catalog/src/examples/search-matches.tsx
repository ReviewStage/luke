import { SearchMatch } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/** search-matches.tsx -- the words a search's query landed on, marked in a line. */

function SearchMatches(): React.JSX.Element {
  return (
    <CatalogSection id="search-match" title="In a line">
      <div className="catalog-frame">
        Change the <SearchMatch>theme</SearchMatch> of the window
      </div>
    </CatalogSection>
  );
}

export const SEARCH_MATCHES_EXAMPLE: Example = {
  id: "search-matches",
  title: "Search matches",
  Render: SearchMatches,
};
