import { GAP, Pagination, Stack } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * pagination.tsx -- numbered pages at either end and in the middle of a long
 * run, a few pages that all fit, and steps that say where they go.
 */

/** A synthetic page's address. */
function pageHref(page: number): string {
  return `#page-${page}`;
}

/** Page `current` of `count`, with a step to either side where there is one. */
function Pages({ current, count }: { current: number; count: number }): React.JSX.Element {
  return (
    <Pagination
      label={`Pages, at ${current} of ${count}`}
      previous={current > 1 ? { href: pageHref(current - 1), label: "Newer page" } : undefined}
      next={current < count ? { href: pageHref(current + 1), label: "Older page" } : undefined}
      pages={{ current, count, href: pageHref }}
    />
  );
}

function Paginations(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="pagination-few" title="A few pages, all shown">
        <Pages current={2} count={4} />
      </CatalogSection>
      <CatalogSection id="pagination-long" title="A long run, at its start, middle, and end">
        <Stack gap={GAP.CONTROL}>
          <Pages current={1} count={21} />
          <Pages current={10} count={21} />
          <Pages current={21} count={21} />
        </Stack>
      </CatalogSection>
      <CatalogSection id="pagination-steps" title="Steps that say where they go">
        <Stack gap={GAP.CONTROL}>
          <Pagination
            label="Releases"
            previous={{ href: "#v1-5-0", label: "Newer release, v1.5.0", text: "v1.5.0" }}
            next={{ href: "#v1-3-0", label: "Older release, v1.3.0", text: "v1.3.0" }}
          />
          <Pagination
            label="Releases at the newest"
            previous={undefined}
            next={{ href: "#v1-3-0", label: "Older release, v1.3.0", text: "v1.3.0" }}
          />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const PAGINATION_EXAMPLE: Example = {
  id: "pagination",
  title: "Pagination",
  Render: Paginations,
};
