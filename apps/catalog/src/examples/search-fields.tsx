import { GAP, SearchField, type SearchTally, Stack } from "@luke/ui";
import { type ReactNode, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * search-fields.tsx -- a SearchField empty with its chord, holding a query
 * with its clear, with a tally of its results and of none, its tally folded
 * as a narrow bar folds it, and in a narrow column with a long query.
 */

/** A search the example holds the query of, as a caller would. */
function Held({
  start,
  label,
  placeholder,
  tally,
  shortcut,
  clears = false,
}: {
  start: string;
  label: string;
  placeholder?: string;
  tally?: SearchTally;
  shortcut?: ReactNode;
  clears?: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState(start);
  return (
    <SearchField
      label={label}
      placeholder={placeholder}
      value={query}
      onChange={setQuery}
      shortcut={shortcut}
      {...(tally === undefined ? undefined : { tally })}
      {...(clears ? { onClear: () => setQuery("") } : undefined)}
      onEscape={() => setQuery("")}
    />
  );
}

function SearchFields(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="search-states" title="Empty, and holding a query">
        <div className="catalog-column">
          <Stack gap={GAP.FIELD}>
            <Held
              start=""
              label="Search integrations and tools"
              placeholder="Search integrations and tools"
              shortcut={<kbd>⌘F</kbd>}
              clears
            />
            <Held
              start="deploy"
              label="Search integrations and tools"
              placeholder="Search integrations and tools"
              clears
            />
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="search-tally" title="With a tally">
        <div className="catalog-column">
          <Stack gap={GAP.FIELD}>
            <Held start="plan" label="Find" placeholder="Find" tally={{ count: 12, at: 2 }} />
            <Held start="planx" label="Find" placeholder="Find" tally={{ count: 0 }} />
          </Stack>
        </div>
      </CatalogSection>
      <CatalogSection id="search-folded" title="Folded, its tally said rather than drawn">
        <div className="catalog-folded catalog-narrow">
          <Held start="plan" label="Find" placeholder="Find" tally={{ count: 12, at: 2 }} />
        </div>
      </CatalogSection>
      <CatalogSection id="search-narrow" title="Narrow column, long query">
        <div className="catalog-narrow">
          <Held
            start="a query whose words run past its column"
            label="Search"
            placeholder="Search"
            clears
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const SEARCH_FIELDS_EXAMPLE: Example = {
  id: "search-fields",
  title: "Search fields",
  Render: SearchFields,
};
